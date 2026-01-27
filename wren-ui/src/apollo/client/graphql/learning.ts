import { gql } from '@apollo/client';

export const LEARNING_RECORD = gql`
  query LearningRecord($projectId: Int!) {
    learningRecord(projectId: $projectId) {
      paths
    }
  }
`;

export const SAVE_LEARNING_RECORD = gql`
  mutation SaveLearningRecord(
    $projectId: Int!
    $data: SaveLearningRecordInput!
  ) {
    saveLearningRecord(projectId: $projectId, data: $data) {
      paths
    }
  }
`;
