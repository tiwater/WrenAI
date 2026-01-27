import { gql } from '@apollo/client';

export const GET_SETTINGS = gql`
  query GetSettings($projectId: Int!) {
    settings(projectId: $projectId) {
      productVersion
      dataSource {
        type
        properties
        sampleDataset
      }
      language
    }
  }
`;

export const RESET_CURRENT_PROJECT = gql`
  mutation ResetCurrentProject($projectId: Int!) {
    resetCurrentProject(projectId: $projectId)
  }
`;

export const UPDATE_CURRENT_PROJECT = gql`
  mutation UpdateCurrentProject(
    $projectId: Int!
    $data: UpdateCurrentProjectInput!
  ) {
    updateCurrentProject(projectId: $projectId, data: $data)
  }
`;
