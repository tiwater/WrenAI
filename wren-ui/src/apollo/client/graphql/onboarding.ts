import { gql } from '@apollo/client';

export const ONBOARDING_STATUS = gql`
  query OnboardingStatus($projectId: Int!) {
    onboardingStatus(projectId: $projectId) {
      status
    }
  }
`;
