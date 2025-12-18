import { gql } from '@apollo/client';

export const CREATE_VIEW = gql`
  mutation CreateView($projectId: Int!, $data: CreateViewInput!) {
    createView(projectId: $projectId, data: $data) {
      id
      name
      statement
    }
  }
`;

export const DELETE_VIEW = gql`
  mutation DeleteView($projectId: Int!, $where: ViewWhereUniqueInput!) {
    deleteView(projectId: $projectId, where: $where)
  }
`;

export const GET_VIEW = gql`
  query GetView($projectId: Int!, $where: ViewWhereUniqueInput!) {
    view(projectId: $projectId, where: $where) {
      id
      name
      statement
    }
  }
`;

export const LIST_VIEWS = gql`
  query ListViews($projectId: Int!) {
    listViews(projectId: $projectId) {
      id
      name
      displayName
      statement
    }
  }
`;

export const PREVIEW_VIEW_DATA = gql`
  mutation PreviewViewData($projectId: Int!, $where: PreviewViewDataInput!) {
    previewViewData(projectId: $projectId, where: $where)
  }
`;

export const VALIDATE_CREATE_VIEW = gql`
  mutation ValidateView($projectId: Int!, $data: ValidateViewInput!) {
    validateView(projectId: $projectId, data: $data) {
      valid
      message
    }
  }
`;
