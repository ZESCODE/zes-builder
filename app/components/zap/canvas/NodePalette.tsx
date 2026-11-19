import type { NodeTypeDescriptor } from '~/lib/workflows/contract';

const GROUP_ORDER = ['agent', 'control', 'tool', 'output'];

export function NodePalette({ descriptors }: { descriptors: NodeTypeDescriptor[] }) {
  const groups = GROUP_ORDER.map((category) => ({
    category,
    items: descriptors.filter((descriptor) => descriptor.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-bolt-elements-textTertiary uppercase">Nodes</h2>
        <p className="mt-1 text-[11px] text-bolt-elements-textTertiary">Drag onto the canvas or click to add.</p>
      </div>

      {groups.map((group) => (
        <div key={group.category}>
          <p className="mb-1.5 text-[10px] font-semibold tracking-wide text-bolt-elements-textTertiary uppercase">
            {group.category}
          </p>
          <div className="flex flex-col gap-1">
            {group.items.map((descriptor) => (
              <button
                key={descriptor.type}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-zap-node', descriptor.type);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                title={descriptor.description}
                className="cursor-grab rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3 px-2 py-1.5 text-left text-xs text-bolt-elements-textPrimary transition-colors hover:border-accent-500/60 hover:bg-bolt-elements-background-depth-4 active:cursor-grabbing"
              >
                {descriptor.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
