import { useEffect, useMemo } from 'react';
import { cloneDeep } from 'lodash';
import { ApolloClient, NormalizedCacheObject } from '@apollo/client';
import { THREAD } from '@/apollo/client/graphql/home';
import { nextTick } from '@/utils/time';
import { useSelectedProject } from '@/contexts/ProjectContext';
import {
  useAdjustThreadResponseMutation,
  useCancelAdjustmentTaskMutation,
  useRerunAdjustmentTaskMutation,
  useThreadResponseLazyQuery,
} from '@/apollo/client/graphql/home.generated';
import {
  AskingTaskStatus,
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

export const getIsFinished = (status: AskingTaskStatus) =>
  [
    AskingTaskStatus.FINISHED,
    AskingTaskStatus.FAILED,
    AskingTaskStatus.STOPPED,
  ].includes(status);

const handleUpdateThreadCache = (
  threadId: number,
  threadResponse: ThreadResponse,
  projectId: number,
  client: ApolloClient<NormalizedCacheObject>,
) => {
  const result = client.cache.readQuery<{ thread: DetailedThread }>({
    query: THREAD,
    variables: { projectId, threadId },
  });

  if (result?.thread) {
    client.cache.updateQuery(
      {
        query: THREAD,
        variables: { projectId, threadId },
      },
      (existingData) => {
        const isNewResponse = !existingData.thread.responses
          .map((r) => r.id)
          .includes(threadResponse.id);
        return {
          thread: {
            ...existingData.thread,
            responses: isNewResponse
              ? [...existingData.thread.responses, threadResponse]
              : existingData.thread.responses.map((response) => {
                  return response.id === threadResponse.id
                    ? cloneDeep(threadResponse)
                    : response;
                }),
          },
        };
      },
    );
  }
};

export default function useAdjustAnswer(threadId?: number) {
  const projectId = useSelectedProject();
  const [cancelAdjustmentTask] = useCancelAdjustmentTaskMutation({
    onError: (error) => console.error(error),
  });
  const [rerunAdjustmentTask] = useRerunAdjustmentTaskMutation({
    onError: (error) => console.error(error),
  });
  const [adjustThreadResponse, adjustThreadResponseResult] =
    useAdjustThreadResponseMutation({
      onError: (error) => console.error(error),
    });
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      pollInterval: 1000,
    });

  const loading = adjustThreadResponseResult.loading;

  const adjustmentTask = useMemo(() => {
    return threadResponseResult.data?.threadResponse.adjustmentTask || null;
  }, [threadResponseResult.data]);

  const data = useMemo(() => {
    return {
      adjustmentTask,
    };
  }, [adjustmentTask]);

  useEffect(() => {
    const isFinished = getIsFinished(adjustmentTask?.status);
    if (isFinished) threadResponseResult.stopPolling();
  }, [adjustmentTask?.status]);

  const onAdjustReasoningSteps = async (
    responseId: number,
    input: { tables: string[]; sqlGenerationReasoning: string },
  ) => {
    if (!projectId) return;
    const response = await adjustThreadResponse({
      variables: {
        projectId,
        responseId,
        data: {
          tables: input.tables,
          sqlGenerationReasoning: input.sqlGenerationReasoning,
        },
      },
    });

    // start polling new thread response
    const nextThreadResponse = response.data?.adjustThreadResponse;
    await fetchThreadResponse({
      variables: { projectId, responseId: nextThreadResponse.id },
    });

    // update new thread response to cache
    if (projectId) {
      handleUpdateThreadCache(
        threadId,
        nextThreadResponse,
        projectId,
        threadResponseResult.client,
      );
    }
  };

  const onAdjustSQL = async (responseId: number, sql: string) => {
    if (!projectId) return;
    const response = await adjustThreadResponse({
      variables: { projectId, responseId, data: { sql } },
    });

    // update thread cache
    const nextThreadResponse = response.data?.adjustThreadResponse;
    if (projectId) {
      handleUpdateThreadCache(
        threadId,
        nextThreadResponse,
        projectId,
        threadResponseResult.client,
      );
    }

    // It won't have adjusmentTask, no need to fetch
  };

  const onStop = async (queryId?: string) => {
    const taskId =
      queryId ||
      adjustThreadResponseResult.data?.adjustThreadResponse?.adjustmentTask
        ?.queryId;
    if (taskId) {
      await cancelAdjustmentTask({ variables: { taskId } });
      // waiting for polling fetching stop
      await nextTick(1000);
    }
  };

  const onReRun = async (threadResponse: ThreadResponse) => {
    const responseId = threadResponse.id;
    if (!projectId) return;
    await rerunAdjustmentTask({ variables: { projectId, responseId } });
    await fetchThreadResponse({ variables: { projectId, responseId } });
  };

  return {
    data,
    loading,
    onAdjustReasoningSteps,
    onAdjustSQL,
    onStop,
    onReRun,
  };
}
