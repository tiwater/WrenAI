import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { Path } from '@/utils/enum';
import { ONBOARDING_STATUS } from '@/apollo/client/graphql/onboarding';
import { useStartSampleDatasetMutation } from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';
import { useSelectedProject } from '@/contexts/ProjectContext';

export default function useSetupConnectionSampleDataset() {
  const projectId = useSelectedProject();
  const router = useRouter();

  const [startSampleDatasetMutation, { loading, error }] =
    useStartSampleDatasetMutation({
      onError: (error) => console.error(error),
      onCompleted: () => {
        // Clear the creating new project flags
        sessionStorage.removeItem('newProjectName');
        sessionStorage.removeItem('creatingNewProject');
        router.push(Path.Modeling);
      },
      refetchQueries: [{ query: ONBOARDING_STATUS }],
      awaitRefetchQueries: true,
    });

  const saveSampleDataset = useCallback(
    async (template: SampleDatasetName) => {
      // Get project name from sessionStorage if creating a new project
      const projectName = sessionStorage.getItem('newProjectName');
      const data: any = { name: template };
      
      if (projectName) {
        data.projectName = projectName;
        // Don't remove here, will be removed after save completes
      }
      
      await startSampleDatasetMutation({
        variables: { data },
      });
    },
    [startSampleDatasetMutation],
  );

  return {
    loading,
    error,
    saveSampleDataset,
  };
}
