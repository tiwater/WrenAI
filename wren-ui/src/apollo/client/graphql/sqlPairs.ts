import { gql } from '@apollo/client';

const SQL_PAIR = gql`
  fragment SqlPair on SqlPair {
    id
    projectId
    sql
    question
    createdAt
    updatedAt
  }
`;

export const LIST_SQL_PAIRS = gql`
  query SqlPairs($projectId: Int!) {
    sqlPairs(projectId: $projectId) {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const CREATE_SQL_PAIR = gql`
  mutation CreateSqlPair($projectId: Int!, $data: CreateSqlPairInput!) {
    createSqlPair(projectId: $projectId, data: $data) {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const UPDATE_SQL_PAIR = gql`
  mutation UpdateSqlPair(
    $projectId: Int!
    $where: SqlPairWhereUniqueInput!
    $data: UpdateSqlPairInput!
  ) {
    updateSqlPair(projectId: $projectId, where: $where, data: $data) {
      ...SqlPair
    }
  }

  ${SQL_PAIR}
`;

export const DELETE_SQL_PAIR = gql`
  mutation DeleteSqlPair($projectId: Int!, $where: SqlPairWhereUniqueInput!) {
    deleteSqlPair(projectId: $projectId, where: $where)
  }
`;
