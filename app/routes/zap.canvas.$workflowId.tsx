import type { MetaFunction } from 'react-router';
import { ClientOnly } from 'remix-utils/client-only';
import { Header } from '~/components/header/Header';
import { AccessGate } from '~/components/whop/AccessGate';
import { WorkflowCanvasRoot } from '~/components/zap/canvas/WorkflowCanvas';
import { hubConfigured, zapNodeTypes } from '~/lib/hub.server';
import type { NodeTypeDescriptor } from '~/lib/workflows/contract';

export const meta: MetaFunction = () => {
  return [{ title: 'Edit workflow — ZES' }];
};

export async function loader({ params, request }: { params: { workflowId?: string }; request: Request }) {
  if (!hubConfigured()) {
    return Response.json({ descriptors: [] as NodeTypeDescriptor[], error: 'Hub is not configured' });
  }

  try {
    const result = await zapNodeTypes();
    const data = result.data as { nodeTypes?: NodeTypeDescriptor[]; error?: string };

    return Response.json({
      descriptors: data.nodeTypes ?? [],
      workflowId: params.workflowId ?? null,
      jobId: new URL(request.url).searchParams.get('job'),
      error: data.error ?? null,
    });
  } catch (error) {
    return Response.json({
      descriptors: [] as NodeTypeDescriptor[],
      workflowId: params.workflowId ?? null,
      jobId: new URL(request.url).searchParams.get('job'),
      error: error instanceof Error ? error.message : 'Failed to load node types',
    });
  }
}

export default function ZapCanvasEditRoute({
  loaderData,
}: {
  loaderData: {
    descriptors: NodeTypeDescriptor[];
    workflowId: string | null;
    jobId: string | null;
    error: string | null;
  };
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
              {() => (
                <WorkflowCanvasRoot
                  descriptors={loaderData.descriptors}
                  workflowId={loaderData.workflowId ?? undefined}
                  jobId={loaderData.jobId ?? undefined}
                />
              )}
            </ClientOnly>
          </div>
        )}
      </div>
    </AccessGate>
  );
}
