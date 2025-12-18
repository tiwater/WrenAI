import { gql } from '@apollo/client';

export const UPDATE_MODEL_METADATA = gql`
  mutation UpdateModelMetadata(
    $projectId: Int!
    $where: ModelWhereInput!
    $data: UpdateModelMetadataInput!
  ) {
    updateModelMetadata(projectId: $projectId, where: $where, data: $data)
  }
`;

export const UPDATE_VIEW_METADATA = gql`
  mutation UpdateViewMetadata(
    $projectId: Int!
    $where: ViewWhereUniqueInput!
    $data: UpdateViewMetadataInput!
  ) {
    updateViewMetadata(projectId: $projectId, where: $where, data: $data)
  }
`;
