import { gql } from '@apollo/client';

export const API_HISTORY = gql`
  query ApiHistory(
    $projectId: Int!
    $filter: ApiHistoryFilterInput
    $pagination: ApiHistoryPaginationInput!
  ) {
    apiHistory(
      projectId: $projectId
      filter: $filter
      pagination: $pagination
    ) {
      items {
        id
        projectId
        apiType
        threadId
        headers
        requestPayload
        responsePayload
        statusCode
        durationMs
        createdAt
        updatedAt
      }
      total
      hasMore
    }
  }
`;
