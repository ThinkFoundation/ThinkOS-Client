import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Fingerprint, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api';

interface Props {
  needsSetup: boolean;
  onUnlock: () => void;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  let greeting: string;
  if (hour < 12) {
    greeting = "Good morning.";
  } else if (hour < 18) {
    greeting = "Good afternoon.";
  } else {
    greeting = "Good evening.";
  }
  return greeting;
}

export default function LockScreen({ needsSetup, onUnlock }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [shaking, setShaking] = useState(false);

  const triggerShake = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 400);
  };

  const handleSetup = async () => {
    if (password.length < 8 || password !== confirmPassword) {
      triggerShake();
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onUnlock(), 600);
      } else {
        triggerShake();
        setLoading(false);
      }
    } catch {
      triggerShake();
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (!password) return;

    setLoading(true);

    try {
      const res = await apiFetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onUnlock(), 600);
      } else {
        triggerShake();
        setPassword('');
        setLoading(false);
      }
    } catch {
      triggerShake();
      setLoading(false);
    }
  };

  return (
    <div className={cn(
      "relative flex items-center justify-center min-h-screen bg-background p-4 transition-opacity duration-500",
      success && "opacity-0"
    )}>
      {/* Animated gradient background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-primary/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative w-full max-w-[320px] space-y-8">
        {/* Logo */}
        <div className="flex justify-center">
          <img
            src="./branding/Think_OS_Full_Word_Mark-lightmode.svg"
            alt="Think"
            className="h-8 dark:hidden"
          />
          <img
            src="./branding/Think_OS_Full_Word_Mark.svg"
            alt="Think"
            className="h-8 hidden dark:block"
          />
        </div>

        {/* Fingerprint Icon */}
        <div className="flex justify-center">
          <div className={cn(
            "transition-all duration-500 ease-out",
            success && "scale-125",
            loading && "opacity-50"
          )}>
            <Fingerprint className={cn(
              "h-16 w-16 transition-colors duration-500",
              success ? "text-green-500" : "text-primary",
              !loading && !success && "animate-pulse"
            )} />
          </div>
        </div>

        {/* Minimal Card */}
        <Card className={cn(
          "shadow-large",
          shaking && "animate-shake"
        )}>
          <CardContent className="pt-6 pb-6">
            <div className="space-y-3">
              {needsSetup ? (
                <>
                    <div className="relative">
                      <h1 className="text-2xl font-light mb-2">{getGreeting()}</h1>
                      <p className="text-sm">
                        To get started, set a secure password. Choose wisely, as it can not be reset.
                      </p>
                    </div>
                    <div className="relative">
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={loading || success}
                        className="text-center pl-10 pr-10"
                      />
                    </div>
                    <div className="relative">
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !loading && handleSetup()}
                        disabled={loading || success}
                        className="text-center pl-10 pr-10"
                      />
                      <button
                        onClick={handleSetup}
                        disabled={loading || success}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                      >
                        {loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowRight className="h-4 w-4" />
                        )}
                      </button>
                  </div>
                </>
              ) : (
                  <div className="relative">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !loading && handleUnlock()}
                      autoFocus
                      disabled={loading || success}
                      className="text-center pl-10 pr-10"
                    />
                    <button
                      onClick={handleUnlock}
                      disabled={loading || success}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                    </button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
