#!/usr/bin/env pwsh
<#
.SYNOPSIS
    ThinkOS-Client Windows Setup Script
.DESCRIPTION
    Automated setup script for ThinkOS-Client on Windows.
    Installs dependencies, builds the extension and native stub,
    and registers the native messaging host.
.NOTES
    Requires: Windows 10/11, Python 3.12, Node.js 18+, pnpm
#>

param(
    [switch]$SkipPython,
    [switch]$SkipNode,
    [switch]$SkipBuild,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
ThinkOS-Client Windows Setup Script

Usage: .\scripts\setup-windows.ps1 [options]

Options:
    -SkipPython    Skip Python version check and installation
    -SkipNode      Skip Node.js dependency installation
    -SkipBuild     Skip building extension and native stub
    -Help          Show this help message

"@
    exit 0
}

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Header
Write-Host @"

  _____ _     _       _     ___  ____  
 |_   _| |__ (_)_ __ | | __/ _ \/ ___| 
   | | | '_ \| | '_ \| |/ / | | \___ \ 
   | | | | | | | | | |   <| |_| |___) |
   |_| |_| |_|_|_| |_|_|\_\\___/|____/ 
                                       
  Windows Setup Script

"@ -ForegroundColor Magenta

# Check if running from project root
if (-not (Test-Path "package.json")) {
    Write-Error "Please run this script from the project root directory"
    exit 1
}

# Step 1: Check Python
if (-not $SkipPython) {
    Write-Step "Checking Python Installation"
    
    $pythonVersion = $null
    try {
        $pythonVersion = (python --version 2>&1) -replace "Python ", ""
    } catch {
        $pythonVersion = $null
    }
    
    if ($pythonVersion -and $pythonVersion -match "^3\.12") {
        Write-Success "Python $pythonVersion detected"
    } elseif ($pythonVersion -and $pythonVersion -match "^3\.13") {
        Write-Warning "Python 3.13 detected - this may have compatibility issues"
        Write-Host "Recommended: Install Python 3.12 for best compatibility" -ForegroundColor Yellow
        
        # Check if 3.12 is available via py launcher
        try {
            $py312 = py -3.12 --version 2>&1
            if ($py312 -match "3\.12") {
                Write-Success "Python 3.12 also available via 'py -3.12'"
                Write-Host "Consider using: poetry env use py -3.12" -ForegroundColor Yellow
            }
        } catch {}
    } else {
        Write-Warning "Python 3.12 not found (current: $pythonVersion)"
        Write-Host "Installing Python 3.12 via winget..." -ForegroundColor Yellow
        
        try {
            winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
            Write-Success "Python 3.12 installed"
            Write-Host "Please restart your terminal and run this script again." -ForegroundColor Yellow
            exit 0
        } catch {
            Write-Error "Failed to install Python 3.12. Please install manually from python.org"
            exit 1
        }
    }
    
    # Check Poetry
    try {
        $poetryVersion = poetry --version 2>&1
        Write-Success "Poetry detected: $poetryVersion"
    } catch {
        Write-Warning "Poetry not found. Installing..."
        try {
            (Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
            Write-Success "Poetry installed"
            Write-Host "Please restart your terminal and run this script again." -ForegroundColor Yellow
            exit 0
        } catch {
            Write-Error "Failed to install Poetry. Please install manually: https://python-poetry.org/docs/#installation"
            exit 1
        }
    }
}

# Step 2: Install Node dependencies
if (-not $SkipNode) {
    Write-Step "Installing Node.js Dependencies"
    
    try {
        pnpm --version | Out-Null
    } catch {
        Write-Error "pnpm not found. Please install pnpm: npm install -g pnpm"
        exit 1
    }
    
    Write-Host "Running pnpm install..." -ForegroundColor Gray
    pnpm install
    Write-Success "Node.js dependencies installed"
}

# Step 3: Install Python dependencies
Write-Step "Installing Python Dependencies"

Push-Location backend
try {
    # Try to use Python 3.12 specifically
    $python312Path = $null
    try {
        $python312Path = (py -3.12 -c "import sys; print(sys.executable)" 2>$null)
    } catch {}
    
    if ($python312Path) {
        Write-Host "Configuring Poetry to use Python 3.12..." -ForegroundColor Gray
        poetry env use $python312Path 2>$null
    }
    
    Write-Host "Running poetry install..." -ForegroundColor Gray
    poetry install
    Write-Success "Python dependencies installed"
} catch {
    Write-Error "Failed to install Python dependencies: $_"
    Pop-Location
    exit 1
}
Pop-Location

# Step 4: Build extension
if (-not $SkipBuild) {
    Write-Step "Building Chrome Extension"
    
    try {
        pnpm ext
        Write-Success "Extension built: extension/dist/"
    } catch {
        Write-Error "Failed to build extension: $_"
        exit 1
    }
    
    # Step 5: Build native stub
    Write-Step "Building Native Messaging Stub"
    
    try {
        pnpm build:stub
        
        $stubPath = "backend/native_host/think-native-stub.exe"
        if (Test-Path $stubPath) {
            Write-Success "Native stub built: $stubPath"
        } else {
            Write-Error "Native stub not found after build"
            exit 1
        }
    } catch {
        Write-Error "Failed to build native stub: $_"
        exit 1
    }
}

# Step 6: Register native messaging host
Write-Step "Registering Native Messaging Host"

$stubPath = (Resolve-Path "backend/native_host/think-native-stub.exe").Path
$manifestDir = (Resolve-Path "backend/native_host").Path
$manifestPath = Join-Path $manifestDir "com.think.native.json"

# Create manifest
$manifest = @{
    name = "com.think.native"
    description = "Think Native Messaging Host - Secure communication between Think browser extension and desktop app"
    path = $stubPath
    type = "stdio"
    allowed_origins = @("chrome-extension://ddkjmfghdikcpfnemhpecpmiajjhghoi/")
} | ConvertTo-Json -Depth 10

$manifest | Out-File -FilePath $manifestPath -Encoding UTF8 -NoNewline
Write-Success "Created manifest: $manifestPath"

# Add registry entries
$browsers = @(
    @{ Name = "Chrome"; Path = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.think.native" },
    @{ Name = "Edge"; Path = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.think.native" }
)

foreach ($browser in $browsers) {
    try {
        New-Item -Path $browser.Path -Force | Out-Null
        Set-ItemProperty -Path $browser.Path -Name "(Default)" -Value $manifestPath
        Write-Success "Registered native host for $($browser.Name)"
    } catch {
        Write-Warning "Failed to register for $($browser.Name): $_"
    }
}

# Done!
Write-Host @"

=== Setup Complete! ===

"@ -ForegroundColor Green

Write-Host @"
Next steps:

1. Load the Chrome extension:
   - Open Chrome and go to: chrome://extensions
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select folder: extension/dist

2. Start the development servers:
   pnpm dev

   Or start individually:
   - Backend: pnpm backend
   - Electron: pnpm app

3. The extension should now connect to the backend!

"@ -ForegroundColor White

Write-Host "For issues, see: .ai/windows-compatibility-report.md" -ForegroundColor Gray
