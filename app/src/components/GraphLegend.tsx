import { useState } from 'react';
import { glass, memoryTypeColors } from '@/lib/design-tokens';
import { cn } from '@/lib/utils';
import { Info } from 'lucide-react';

interface GraphLegendProps {
  colorMode?: 'none' | 'community';
  communityColors?: string[];
  communityLabels?: string[];
}

const NODE_TYPES = [
  { color: memoryTypeColors.web.bg, label: 'Web' },
  { color: memoryTypeColors.note.bg, label: 'Note' },
  { color: memoryTypeColors.voice_memo.bg, label: 'Voice Memo' },
  { color: memoryTypeColors.audio.bg, label: 'Audio' },
  { color: memoryTypeColors.video.bg, label: 'Video' },
  { color: memoryTypeColors.document.bg, label: 'Document' },
];

export default function GraphLegend({
  colorMode = 'none',
  communityColors = [],
  communityLabels = [],
}: GraphLegendProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="absolute bottom-4 right-4">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer transition-all duration-200",
            glass.overlay,
            "hover:bg-white/50 dark:hover:bg-white/[0.05]"
          )}
        >
          <Info className="h-3.5 w-3.5 text-muted-foreground" />
          Legend
        </button>
      ) : (
        <div
          className={cn(
            "space-y-3 rounded-2xl p-3 text-xs max-w-[200px] animate-fade-in-up",
            glass.overlay
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-xs">Legend</span>
            <button
              onClick={() => setExpanded(false)}
              className="text-muted-foreground hover:text-foreground text-xs px-1"
            >
              &times;
            </button>
          </div>

          {/* Node Types - show only when not in community mode */}
          {colorMode === 'none' && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Node Types</div>
              {NODE_TYPES.map((type) => (
                <div key={type.label} className="flex items-center gap-2">
                  <div className={`h-3.5 w-3.5 rounded-full ${type.color}`} />
                  <span>{type.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Community Colors - show when in community mode */}
          {colorMode === 'community' && communityColors.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Communities</div>
              {communityColors.slice(0, 8).map((color, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate">{communityLabels[idx] || `Community ${idx + 1}`}</span>
                </div>
              ))}
              {communityColors.length > 8 && (
                <div className="text-muted-foreground">+{communityColors.length - 8} more</div>
              )}
            </div>
          )}

          {/* Link Types */}
          <div className="space-y-1.5 border-t border-white/15 dark:border-white/[0.06] pt-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Connections</div>
            <div className="flex items-center gap-2">
              <div className="h-0.5 w-6 bg-blue-500" />
              <span>Manual links</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-0.5 w-6 bg-slate-500" />
              <span>AI-suggested links</span>
            </div>
          </div>

          {/* Size Legend */}
          <div className="border-t border-white/15 dark:border-white/[0.06] pt-2 text-muted-foreground">
            Node size = connection count
          </div>
        </div>
      )}
    </div>
  );
}
