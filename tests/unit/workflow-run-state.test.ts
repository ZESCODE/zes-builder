import { describe, expect, it } from 'vitest';

import { parseRunState } from '~/lib/workflows/run-state';

describe('run state projection', () => {
  it('reads the job status and workflow version from the builder proxy shape', () => {
    const state = parseRunState({
      job: { job: { id: 'job_1', status: 'running', workflow_version: 4 }, tasks: [] },
      usage: null,
    });

    expect(state.jobStatus).toBe('running');
    expect(state.workflowVersion).toBe(4);
  });

  it('reads the job status from the raw hub shape', () => {
    const state = parseRunState({ job: { id: 'job_1', status: 'completed', workflow_version: 2 }, tasks: [] });

    expect(state.jobStatus).toBe('completed');
    expect(state.workflowVersion).toBe(2);
  });

  it('maps persisted task status onto node ids', () => {
    const state = parseRunState(
      { job: { id: 'job_1', status: 'running', workflow_version: 1 }, tasks: [] },
      {
        tasks: [
          { node_id: 'castor_1', status: 'completed' },
          { node_id: 'john_2', status: 'running' },
          { node_id: 'output_3', status: 'pending' },
        ],
      },
    );

    expect(state.nodeStatus).toEqual({
      castor_1: 'completed',
      john_2: 'running',
      output_3: 'pending',
    });
  });

  it('falls back to the tasks embedded in the job payload', () => {
    const state = parseRunState({
      job: {
        job: { id: 'job_1', status: 'failed', workflow_version: 3 },
        tasks: [{ node_id: 'castor_1', status: 'failed' }],
      },
    });

    expect(state.jobStatus).toBe('failed');
    expect(state.nodeStatus.castor_1).toBe('failed');
  });

  it('returns an empty projection for an unknown payload', () => {
    const state = parseRunState(null, undefined);

    expect(state.jobStatus).toBeNull();
    expect(state.workflowVersion).toBeNull();
    expect(state.nodeStatus).toEqual({});
  });
});
