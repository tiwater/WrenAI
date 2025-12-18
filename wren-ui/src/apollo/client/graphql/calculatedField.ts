import { gql } from '@apollo/client';

export const VALIDATE_CALCULATED_FIELD = gql`
  mutation ValidateCalculatedField($projectId: Int!, $data: ValidateCalculatedFieldInput!) {
    validateCalculatedField(projectId: $projectId, data: $data) {
      message
      valid
    }
  }
`;

export const CREATE_CALCULATED_FIELD = gql`
  mutation CreateCalculatedField($projectId: Int!, $data: CreateCalculatedFieldInput!) {
    createCalculatedField(projectId: $projectId, data: $data)
  }
`;

export const UPDATE_CALCULATED_FIELD = gql`
  mutation UpdateCalculatedField(
    $projectId: Int!
    $where: UpdateCalculatedFieldWhere!
    $data: UpdateCalculatedFieldInput!
  ) {
    updateCalculatedField(projectId: $projectId, where: $where, data: $data)
  }
`;

export const DELETE_CALCULATED_FIELD = gql`
  mutation DeleteCalculatedField($projectId: Int!, $where: UpdateCalculatedFieldWhere!) {
    deleteCalculatedField(projectId: $projectId, where: $where)
  }
`;
