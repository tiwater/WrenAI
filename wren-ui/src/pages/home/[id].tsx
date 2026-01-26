import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
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
import { Path } from '@/utils/enum';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import { useProject } from '@/contexts/ProjectContext';
import SiderLayout from '@/components/layouts/SiderLayout';
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
  AskStep,
  DetailedThread,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';
import {
  SqlPairsDocument,
  useCreateSqlPairMutation,
} from '@/apollo/client/graphql/sqlPairs.generated';

const getThreadResponseIsFinished = (threadResponse: ThreadResponse) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  // it means it's the old data before support text based answer
  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  // false make it keep polling when the text based answer is default needed.
  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  // answerDetail status can be FAILED before getting queryId from Wren AI adapter
  if (answerDetail?.queryId || answerDetail?.status) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (chartDetail?.queryId) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }
  // if equal false, it means it has task & the task is not finished
  return isAnswerFinished !== false && isChartFinished !== false;
};

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const params = useParams();
  const { selectedProjectId: projectId, hydrated } = useProject();
  const homeSidebar = useHomeSidebar();
  const threadId = useMemo(() => Number(params?.id) || null, [params]);
  const askPrompt = useAskPrompt(threadId);
  const adjustAnswer = useAdjustAnswer(threadId);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();

  useEffect(() => {
    if (!hydrated) return;
    if (!projectId) router.replace(Path.Projects);
  }, [hydrated, projectId, router]);

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);

  const [createViewMutation, { loading: creating }] = useCreateViewMutation({
    onError: (error) => console.error(error),
    onCompleted: () => message.success('Successfully created view.'),
  });

  const { data, updateQuery: updateThreadQuery } = useThreadQuery({
    variables: { projectId, threadId },
    fetchPolicy: 'cache-and-network',
    skip: threadId === null || !projectId,
    onError: () => router.push(Path.Home),
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
      onCompleted: (data) => {
        message.success('Successfully updated the SQL statement');
        // trigger generate answer after sql statement updated
        onGenerateThreadResponseAnswer(data.updateThreadResponse.id);
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
        message.success('Successfully created question-sql pair.');
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
    await generateThreadResponseAnswer({ variables: { projectId, responseId } });
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
    (responses: ThreadResponse[]) => {
      // unfinished asking task
      const unfinishedAskingResponse = (responses || []).find(
        (response) =>
          response?.askingTask && !getIsFinished(response?.askingTask?.status),
      );
      if (unfinishedAskingResponse) {
        if (!projectId) return;

        // If asking task has already failed/stopped, make sure we still fetch
        // the latest threadResponse once so UI can show FAILED status/error.
        if (
          unfinishedAskingResponse.askingTask?.status === AskingTaskStatus.FAILED ||
          unfinishedAskingResponse.askingTask?.status === AskingTaskStatus.STOPPED
        ) {
          fetchThreadResponse({
            variables: { projectId, responseId: unfinishedAskingResponse.id },
          });
          return;
        }

        askPrompt.onFetching(unfinishedAskingResponse?.askingTask?.queryId);
        return;
      }

      // unfinished thread response
      const unfinishedThreadResponse = (responses || []).find(
        (response) => !getThreadResponseIsFinished(response),
      );

      if (
        canFetchThreadResponse(unfinishedThreadResponse?.askingTask) &&
        unfinishedThreadResponse
      ) {
        if (!projectId) return;
        fetchThreadResponse({
          variables: { projectId, responseId: unfinishedThreadResponse.id },
        });
      }
    },
    [askPrompt, fetchThreadResponse, projectId],
  );

  // store thread questions for instant recommended questions
  const storeQuestionsToAskPrompt = useCallback(
    (responses: ThreadResponse[]) => {
      const questions = responses.flatMap((res) => res.question || []);
      if (questions) askPrompt.onStoreThreadQuestions(questions);
    },
    [askPrompt],
  );

  // stop all requests when change thread
  useEffect(() => {
    if (threadId !== null && projectId) {
      fetchThreadRecommendationQuestions({ variables: { projectId, threadId } });
      setShowRecommendedQuestions(true);
    }
    return () => {
      askPrompt.onStopPolling();
      threadResponseResult.stopPolling();
      threadRecommendationQuestionsResult.stopPolling();
      $prompt.current?.close();
    };
  }, [threadId, projectId]);

  // initialize asking task
  useEffect(() => {
    if (!responses) return;
    handleUnfinishedTasks(responses);
    storeQuestionsToAskPrompt(responses);
  }, [responses]);

  useEffect(() => {
    if (isPollingResponseFinished) {
      threadResponseResult.stopPolling();
      setShowRecommendedQuestions(true);
    }
  }, [isPollingResponseFinished]);

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

      if (!projectId) return;

      const threadId = thread.id;
      await createThreadResponse({
        variables: { projectId, threadId, data: payload },
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
    <SiderLayout loading={false} sidebar={homeSidebar}>
      <PromptThreadProvider value={providerValue}>
        <PromptThread />
      </PromptThreadProvider>

      <div className="py-12" />
      <Prompt
        ref={$prompt}
        {...askPrompt}
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
    </SiderLayout>
  );
}
