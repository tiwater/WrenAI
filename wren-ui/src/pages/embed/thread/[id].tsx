import { useRouter } from 'next/router';
import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isEmpty } from 'lodash';
import { message } from 'antd';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt, {
  getIsFinished,
  canFetchThreadResponse,
  isRecommendedFinished,
} from '@/hooks/useAskPrompt';
import useAdjustAnswer from '@/hooks/useAdjustAnswer';
import useModalAction from '@/hooks/useModalAction';
import PromptThread from '@/components/pages/home/promptThread';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import AdjustReasoningStepsModal from '@/components/modals/AdjustReasoningStepsModal';
import AdjustSQLModal from '@/components/modals/AdjustSQLModal';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import { getIsChartFinished } from '@/components/pages/home/promptThread/ChartAnswer';
import { PromptThreadProvider } from '@/components/pages/home/promptThread/store';
import {
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
  useUpdateThreadResponseMutation,
  useGenerateThreadRecommendationQuestionsMutation,
  useGetThreadRecommendationQuestionsLazyQuery,
  useGenerateThreadResponseAnswerMutation,
  useGenerateThreadResponseChartMutation,
  useAdjustThreadResponseChartMutation,
} from '@/apollo/client/graphql/home.generated';
import { useCreateViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  AdjustThreadResponseChartInput,
  CreateThreadResponseInput,
  ThreadResponse,
  CreateSqlPairInput,
  AskingTaskStatus,
  AskingTaskType,
} from '@/apollo/client/graphql/__types__';
import {
  SqlPairsDocument,
  useCreateSqlPairMutation,
} from '@/apollo/client/graphql/sqlPairs.generated';
import { useProject } from '@/contexts/ProjectContext';

const getThreadResponseIsFinished = (threadResponse: ThreadResponse) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  if (answerDetail?.queryId || answerDetail?.status) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (chartDetail?.queryId) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }

  return isAnswerFinished !== false && isChartFinished !== false;
};

export default function EmbedThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const {
    selectedProjectId: projectId,
    setSelectedProjectId,
    hydrated,
  } = useProject();

  const threadId = useMemo(() => {
    const raw = router.query?.id;
    const idStr = Array.isArray(raw) ? raw[0] : raw;
    const id = Number(idStr);
    return Number.isFinite(id) ? id : null;
  }, [router.query?.id]);

  const queryProjectId = useMemo(() => {
    const raw = router.query?.projectId;
    const pidStr = Array.isArray(raw) ? raw[0] : raw;
    if (!pidStr) return null;
    const pid = Number(pidStr);
    return Number.isFinite(pid) ? pid : null;
  }, [router.query?.projectId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!hydrated) return;
    if (queryProjectId && projectId !== queryProjectId) {
      setSelectedProjectId(queryProjectId);
    }
  }, [
    router.isReady,
    hydrated,
    queryProjectId,
    projectId,
    setSelectedProjectId,
  ]);

  const askPrompt = useAskPrompt(threadId);
  const adjustAnswer = useAdjustAnswer(threadId);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);

  const [createViewMutation, { loading: creating }] = useCreateViewMutation({
    onError: (error) => console.error(error),
    onCompleted: () => message.success('已成功创建视图。'),
  });

  const { data, updateQuery: updateThreadQuery } = useThreadQuery({
    variables: { projectId, threadId },
    fetchPolicy: 'cache-and-network',
    skip: threadId === null || !projectId,
  });

  const [createThreadResponse] = useCreateThreadResponseMutation({
    onError: (error) => console.error(error),
    onCompleted(next) {
      const nextResponse = next.createThreadResponse;
      updateThreadQuery((prev) => {
        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: [...prev.thread.responses, nextResponse],
          },
        };
      });

      onGenerateThreadResponseAnswer(nextResponse.id);
    },
  });

  const [updateThreadResponse, { loading: threadResponseUpdating }] =
    useUpdateThreadResponseMutation({
      onError: (error) => console.error(error),
      onCompleted: (d) => {
        message.success('已成功更新 SQL 语句。');
        onGenerateThreadResponseAnswer(d.updateThreadResponse.id);
      },
    });

  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      pollInterval: 1000,
      onCompleted(next) {
        const nextResponse = next.threadResponse;
        updateThreadQuery((prev) => ({
          ...prev,
          thread: {
            ...prev.thread,
            responses: prev.thread.responses.map((response) =>
              response.id === nextResponse.id ? nextResponse : response,
            ),
          },
        }));
      },
    });

  const [generateThreadRecommendationQuestions] =
    useGenerateThreadRecommendationQuestionsMutation({
      onError: (error) => console.error(error),
    });

  const [
    fetchThreadRecommendationQuestions,
    threadRecommendationQuestionsResult,
  ] = useGetThreadRecommendationQuestionsLazyQuery({
    pollInterval: 1000,
  });

  const [generateThreadResponseAnswer] =
    useGenerateThreadResponseAnswerMutation({
      onError: (error) => console.error(error),
    });

  const [generateThreadResponseChart] = useGenerateThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });

  const [adjustThreadResponseChart] = useAdjustThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });

  const [createSqlPairMutation, { loading: createSqlPairLoading }] =
    useCreateSqlPairMutation({
      refetchQueries: projectId
        ? [{ query: SqlPairsDocument, variables: { projectId } }]
        : [],
      awaitRefetchQueries: true,
      onError: (error) => console.error(error),
      onCompleted: () => {
        message.success('已成功创建问题-SQL 对。');
      },
    });

  const thread = useMemo(() => data?.thread || null, [data]);
  const responses = useMemo(() => thread?.responses || [], [thread]);

  const pollingResponse = useMemo(
    () => threadResponseResult.data?.threadResponse || null,
    [threadResponseResult.data],
  );

  const isPollingResponseFinished = useMemo(
    () => getThreadResponseIsFinished(pollingResponse),
    [pollingResponse],
  );

  const onFixSQLStatement = async (responseId: number, sql: string) => {
    if (!projectId) return;
    await updateThreadResponse({
      variables: { projectId, where: { id: responseId }, data: { sql } },
    });
  };

  const onGenerateThreadResponseAnswer = async (responseId: number) => {
    if (!projectId) return;
    await generateThreadResponseAnswer({
      variables: { projectId, responseId },
    });
    fetchThreadResponse({ variables: { projectId, responseId } });
  };

  const onGenerateThreadResponseChart = async (responseId: number) => {
    if (!projectId) return;
    await generateThreadResponseChart({ variables: { projectId, responseId } });
    fetchThreadResponse({ variables: { projectId, responseId } });
  };

  const onAdjustThreadResponseChart = async (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => {
    if (!projectId) return;
    await adjustThreadResponseChart({
      variables: { projectId, responseId, data },
    });
    fetchThreadResponse({ variables: { projectId, responseId } });
  };

  const onGenerateThreadRecommendedQuestions = async () => {
    if (!projectId || threadId === null) return;
    await generateThreadRecommendationQuestions({
      variables: { projectId, threadId },
    });
    fetchThreadRecommendationQuestions({ variables: { projectId, threadId } });
  };

  const handleUnfinishedTasks = useCallback(
    (rs: ThreadResponse[]) => {
      const unfinishedAskingResponse = (rs || []).find(
        (response) =>
          response?.askingTask && !getIsFinished(response?.askingTask?.status),
      );
      if (unfinishedAskingResponse) {
        if (!projectId) return;

        // If asking task has already failed/stopped, make sure we still fetch
        // the latest threadResponse once so UI can show FAILED status/error.
        if (
          unfinishedAskingResponse.askingTask?.status ===
            AskingTaskStatus.FAILED ||
          unfinishedAskingResponse.askingTask?.status ===
            AskingTaskStatus.STOPPED
        ) {
          fetchThreadResponse({
            variables: { projectId, responseId: unfinishedAskingResponse.id },
          });
          return;
        }

        askPrompt.onFetching(unfinishedAskingResponse?.askingTask?.queryId);
        return;
      }

      // CRITICAL: When askingTask is FINISHED but type is GENERAL/MISLEADING_QUERY,
      // the backend marks threadResponse.answerDetail.status as FAILED.
      // We need to fetch the latest threadResponse to get the updated answerDetail.
      const generalOrMisleadingResponse = (rs || []).find(
        (response) =>
          response?.askingTask?.status === AskingTaskStatus.FINISHED &&
          (response?.askingTask?.type === AskingTaskType.GENERAL ||
            response?.askingTask?.type === AskingTaskType.MISLEADING_QUERY) &&
          !getThreadResponseIsFinished(response),
      );
      if (generalOrMisleadingResponse) {
        if (!projectId) return;
        fetchThreadResponse({
          variables: { projectId, responseId: generalOrMisleadingResponse.id },
        });
        return;
      }

      const unfinishedThreadResponse = (rs || []).find(
        (response) => !getThreadResponseIsFinished(response),
      );

      if (!unfinishedThreadResponse) return;
      if (!projectId) return;

      const canPoll =
        !unfinishedThreadResponse.askingTask ||
        canFetchThreadResponse(unfinishedThreadResponse.askingTask);

      if (canPoll) {
        fetchThreadResponse({
          variables: { projectId, responseId: unfinishedThreadResponse.id },
        });
      }
    },
    [askPrompt, fetchThreadResponse, projectId],
  );

  const storeQuestionsToAskPrompt = useCallback(
    (rs: ThreadResponse[]) => {
      const questions = rs.flatMap((res) => res.question || []);
      if (questions) askPrompt.onStoreThreadQuestions(questions);
    },
    [askPrompt],
  );

  useEffect(() => {
    if (threadId !== null && projectId) {
      fetchThreadRecommendationQuestions({
        variables: { projectId, threadId },
      });
      setShowRecommendedQuestions(true);
    }
    return () => {
      askPrompt.onStopPolling();
      threadResponseResult.stopPolling();
      threadRecommendationQuestionsResult.stopPolling();
      $prompt.current?.close();
    };
  }, [threadId, projectId]);

  useEffect(() => {
    if (!responses) return;
    handleUnfinishedTasks(responses);
    storeQuestionsToAskPrompt(responses);

    // Default behavior for embed: keep the latest response in view.
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [responses]);

  useEffect(() => {
    if (isPollingResponseFinished) {
      threadResponseResult.stopPolling();
      setShowRecommendedQuestions(true);
    }
  }, [isPollingResponseFinished]);

  // CRITICAL: When askingTask becomes FINISHED with type GENERAL/MISLEADING_QUERY,
  // the backend marks threadResponse.answerDetail.status as FAILED.
  // We need to directly trigger fetchThreadResponse to get the updated status.
  // This is necessary because responses from useThreadQuery doesn't poll,
  // so handleUnfinishedTasks won't be re-triggered automatically.
  const askingTask = askPrompt.data.askingTask;
  useEffect(() => {
    if (!askingTask || !projectId) return;

    const isFinished = getIsFinished(askingTask.status);
    const isGeneralOrMisleading =
      askingTask.type === AskingTaskType.GENERAL ||
      askingTask.type === AskingTaskType.MISLEADING_QUERY;

    if (isFinished && isGeneralOrMisleading) {
      // Find the response that matches this askingTask
      const matchingResponse = responses.find(
        (r) => r.askingTask?.queryId === askingTask.queryId,
      );
      if (matchingResponse && !getThreadResponseIsFinished(matchingResponse)) {
        fetchThreadResponse({
          variables: { projectId, responseId: matchingResponse.id },
        });
      }
    }
  }, [
    askingTask?.status,
    askingTask?.type,
    askingTask?.queryId,
    projectId,
    responses,
    fetchThreadResponse,
  ]);

  const recommendedQuestions = useMemo(
    () =>
      threadRecommendationQuestionsResult.data
        ?.getThreadRecommendationQuestions || null,
    [threadRecommendationQuestionsResult.data],
  );

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      threadRecommendationQuestionsResult.stopPolling();
    }
  }, [recommendedQuestions]);

  const onCreateResponse = async (payload: CreateThreadResponseInput) => {
    try {
      askPrompt.onStopPolling();

      if (!projectId || !thread) return;

      const nextThreadId = thread.id;
      await createThreadResponse({
        variables: { projectId, threadId: nextThreadId, data: payload },
      });
      setShowRecommendedQuestions(false);
    } catch (error) {
      console.error(error);
    }
  };

  const providerValue = {
    data: thread,
    recommendedQuestions,
    showRecommendedQuestions,
    preparation: {
      askingStreamTask: askPrompt.data?.askingStreamTask,
      onStopAskingTask: askPrompt.onStop,
      onReRunAskingTask: askPrompt.onReRun,
      onStopAdjustTask: adjustAnswer.onStop,
      onReRunAdjustTask: adjustAnswer.onReRun,
      onFixSQLStatement,
      fixStatementLoading: threadResponseUpdating,
    },
    onOpenSaveAsViewModal: saveAsViewModal.openModal,
    onSelectRecommendedQuestion: onCreateResponse,
    onGenerateThreadRecommendedQuestions: onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
    onGenerateChartAnswer: onGenerateThreadResponseChart,
    onAdjustChartAnswer: onAdjustThreadResponseChart,
    onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
    onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
    onOpenAdjustSQLModal: adjustSqlModal.openModal,
  };

  return (
    <div className="h-full">
      <PromptThreadProvider value={providerValue}>
        <PromptThread />
      </PromptThreadProvider>

      <div className="py-12" />

      <div ref={bottomRef} />

      <Prompt
        ref={$prompt}
        {...askPrompt}
        isEmbed
        onCreateResponse={onCreateResponse}
      />

      <SaveAsViewModal
        {...saveAsViewModal.state}
        loading={creating}
        onClose={saveAsViewModal.closeModal}
        onSubmit={async (values) => {
          if (!projectId) return;
          await createViewMutation({
            variables: { projectId, data: values },
          });
        }}
      />

      <QuestionSQLPairModal
        {...questionSqlPairModal.state}
        onClose={questionSqlPairModal.closeModal}
        loading={createSqlPairLoading}
        onSubmit={async ({ data }: { data: CreateSqlPairInput }) => {
          if (!projectId) return;
          await createSqlPairMutation({ variables: { projectId, data } });
        }}
      />

      <AdjustReasoningStepsModal
        {...adjustReasoningStepsModal.state}
        onClose={adjustReasoningStepsModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) => {
          await adjustAnswer.onAdjustReasoningSteps(
            values.responseId,
            values.data,
          );
        }}
      />

      <AdjustSQLModal
        {...adjustSqlModal.state}
        onClose={adjustSqlModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) =>
          await adjustAnswer.onAdjustSQL(values.responseId, values.sql)
        }
      />
    </div>
  );
}
