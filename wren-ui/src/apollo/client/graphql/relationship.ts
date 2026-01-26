import { gql } from '@apollo/client';

export const CREATE_RELATIONSHIP = gql`
  mutation CreateRelationship($projectId: Int!, $data: RelationInput!) {
    createRelation(projectId: $projectId, data: $data)
  }
`;

export const UPDATE_RELATIONSHIP = gql`
  mutation UpdateRelationship(
    $projectId: Int!
    $where: WhereIdInput!
    $data: UpdateRelationInput!
  ) {
    updateRelation(projectId: $projectId, where: $where, data: $data)
  }
`;

export const DELETE_RELATIONSHIP = gql`
  mutation DeleteRelationship($projectId: Int!, $where: WhereIdInput!) {
    deleteRelation(projectId: $projectId, where: $where)
  }
`;
