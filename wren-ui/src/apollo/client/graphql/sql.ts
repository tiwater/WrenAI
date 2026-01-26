import { gql } from '@apollo/client';

export const PREVIEW_SQL_STATEMENT = gql`
  mutation PreviewSQL($projectId: Int!, $data: PreviewSQLDataInput!) {
    previewSql(projectId: $projectId, data: $data)
  }
`;

export const GENERATE_QUESTION = gql`
  mutation GenerateQuestion($projectId: Int!, $data: GenerateQuestionInput!) {
    generateQuestion(projectId: $projectId, data: $data)
  }
`;

export const MODEL_SUBSTITUDE = gql`
  mutation ModelSubstitute($projectId: Int!, $data: ModelSubstituteInput!) {
    modelSubstitute(projectId: $projectId, data: $data)
  }
`;
