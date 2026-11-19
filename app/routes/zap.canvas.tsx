import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { AccessGate } from '~/components/whop/AccessGate';
import { WorkflowCanvasRoot } from '~/components/zap/canvas/WorkflowCanvas';
import { hubConfigured, zapNodeTypes } from '~/lib/hub.server';
import type { NodeTypeDescriptor } from '~/lib/workflows/contract';

export const meta: MetaFunction = () => {
  return [
    { title: 'ZES Workflow Canvas' },
    { name: 'description', content: 'Design ZAP workflows on a canvas and publish them to the hub' },
  ];
};

export async function loader() {
  if (!hubConfigured()) {
    return Response.json({ descriptors: [] as NodeTypeDescriptor[], error: 'Hub is not configured' });
  }

  try {
    const result = await zapNodeTypes();
    const data = result.data as { nodeTypes?: NodeTypeDescriptor[]; error?: string };

    return Response.json({ descriptors: data.nodeTypes ?? [], error: data.error ?? null });
  } catch (error) {
    return Response.json({
      descriptors: [] as NodeTypeDescriptor[],
      error: error instanceof Error ? error.message : 'Failed to load node types',
    });
  }
}

export default function ZapCanvasRoute({
  loaderData,
}: {
  loaderData: { descriptors: NodeTypeDescriptor[]; error: string | null };
}) {
  return (
    <AccessGate>
      <div className="flex h-full w-full flex-col bg-bolt-elements-background-depth-1">
        <Header />
        {loaderData.error ? (
          <div className="p-6 text-sm text-red-400">{loaderData.error}</div>
        ) : (
          <div className="min-h-0 flex-1">
            <ClientOnly fallback={<div className="p-6 text-sm text-bolt-elements-textSecondary">Loading canvas…</div>}>
              {() => <WorkflowCanvasRoot descriptors={loaderData.descriptors} />}
            </ClientOnly>
          </div>
        )}
      </div>
    </AccessGate>
  );
}
