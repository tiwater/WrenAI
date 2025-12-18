import { gql } from '@apollo/client';

export const DEPLOY = gql`
  mutation Deploy($projectId: Int!) {
    deploy(projectId: $projectId)
  }
`;

export const GET_DEPLOY_STATUS = gql`
  query DeployStatus($projectId: Int!) {
    modelSync(projectId: $projectId) {
      status
    }
  }
`;
