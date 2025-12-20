import { useState } from 'react';
import { Path, SETUP } from '@/utils/enum';
import { useRouter } from 'next/router';
import { useOptionalSelectedProject } from '@/contexts/ProjectContext';
import {
  useListDataSourceTablesQuery,
  useSaveTablesMutation,
} from '@/apollo/client/graphql/dataSource.generated';

export default function useSetupModels() {
  const [stepKey] = useState(SETUP.SELECT_MODELS);
  const projectId = useOptionalSelectedProject();
  const router = useRouter();

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    variables: { projectId: projectId! },
    fetchPolicy: 'no-cache',
    onError: (error) => console.error(error),
    skip: !projectId,
  });

  // Handle errors via try/catch blocks rather than onError callback
  const [saveTablesMutation, { loading: submitting }] = useSaveTablesMutation();

  const submitModels = async (tables: string[]) => {
    if (!projectId) {
      console.error('No project selected');
      return;
    }
    try {
      await saveTablesMutation({
        variables: {
          projectId,
          data: { tables },
        },
      });
      router.push(Path.OnboardingRelationships);
    } catch (error) {
      console.error(error);
    }
  };

  const onBack = () => {
    router.push(Path.OnboardingConnection);
  };

  const onNext = (data: { selectedTables: string[] }) => {
    submitModels(data.selectedTables);
  };

  return {
    submitting,
    fetching,
    stepKey,
    onBack,
    onNext,
    tables: data?.listDataSourceTables || [],
  };
}
