import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useOnboardingStatusQuery } from '@/apollo/client/graphql/onboarding.generated';
import { OnboardingStatus } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';
import { useProject } from '@/contexts/ProjectContext';

const redirectRoute = {
  [OnboardingStatus.DATASOURCE_SAVED]: Path.OnboardingModels,
  [OnboardingStatus.NOT_STARTED]: Path.OnboardingConnection,
  [OnboardingStatus.ONBOARDING_FINISHED]: Path.Modeling,
  [OnboardingStatus.WITH_SAMPLE_DATASET]: Path.Modeling,
};

export const useWithOnboarding = () => {
  const router = useRouter();
  const { selectedProjectId, hydrated } = useProject();

  // If no project selected, redirect to projects page
  // If no project selected, redirect to projects page
  useEffect(() => {
    if (!hydrated) return;
    const isCreatingNewProject =
      typeof window !== 'undefined' &&
      (sessionStorage.getItem('newProjectName') ||
        sessionStorage.getItem('creatingNewProject') === 'true');

    if (!selectedProjectId && router.pathname !== Path.Projects) {
      // If creating new project, only allow staying on setup pages
      if (isCreatingNewProject && router.pathname.startsWith(Path.Onboarding)) {
        return;
      }
      router.push(Path.Projects);
    }
  }, [selectedProjectId, hydrated, router]);

  const { data, loading } = useOnboardingStatusQuery({
    variables: { projectId: selectedProjectId || 0 },
    skip: !selectedProjectId,
  });

  const onboardingStatus = data?.onboardingStatus?.status;

  useEffect(() => {
    if (selectedProjectId && onboardingStatus) {
      const newPath = redirectRoute[onboardingStatus];
      const pathname = router.pathname;

      // Check if user is creating a new project (has project name in sessionStorage)
      const isCreatingNewProject =
        typeof window !== 'undefined' &&
        (sessionStorage.getItem('newProjectName') ||
          sessionStorage.getItem('creatingNewProject'));

      // redirect to new path if onboarding is not completed
      if (newPath && newPath !== Path.Modeling) {
        // do not redirect if user is creating a new project
        if (isCreatingNewProject) {
          return;
        }

        // do not redirect if the new path and router pathname are the same
        if (newPath === pathname) {
          return;
        }

        // allow return back to previous steps
        if (
          router.pathname.startsWith(Path.Onboarding) &&
          onboardingStatus !== OnboardingStatus.ONBOARDING_FINISHED
        ) {
          return;
        }

        router.push(newPath);
        return;
      }

      // redirect to home page if onboarding is completed

      // redirect to the home page when entering the Index page
      if (pathname === '/') {
        router.push(newPath);
        return;
      }

      // redirect to home page since user using sample dataset
      if (
        pathname === Path.OnboardingRelationships &&
        onboardingStatus === OnboardingStatus.WITH_SAMPLE_DATASET
      ) {
        router.push(newPath);
        return;
      }

      // Don't redirect if user is creating a new project
      if (isCreatingNewProject) {
        return;
      }

      // redirect to home page when entering the connection page or select models page
      if (
        [Path.OnboardingConnection, Path.OnboardingModels].includes(
          pathname as Path,
        )
      ) {
        router.push(newPath);
        return;
      }
    }
  }, [onboardingStatus, router.pathname]);

  return {
    loading,
    onboardingStatus,
  };
};

export default function useOnboardingStatus() {
  const { selectedProjectId } = useProject();
  const { data, loading, error, refetch } = useOnboardingStatusQuery({
    variables: { projectId: selectedProjectId || 0 },
    skip: !selectedProjectId,
  });

  return {
    loading,
    error,
    refetch,
    onboardingStatus: data?.onboardingStatus?.status,
  };
}
