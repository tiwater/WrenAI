import * as Types from './__types__';

import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
const defaultOptions = {} as const;
export type GetSettingsQueryVariables = Types.Exact<{
  projectId: Types.Scalars['Int'];
}>;

export type GetSettingsQuery = {
  __typename?: 'Query';
  settings: {
    __typename?: 'Settings';
    productVersion: string;
    language: Types.ProjectLanguage;
    dataSource: {
      __typename?: 'DataSource';
      type: Types.DataSourceName;
      properties: any;
      sampleDataset?: Types.SampleDatasetName | null;
    };
  };
};

export type ResetCurrentProjectMutationVariables = Types.Exact<{
  projectId: Types.Scalars['Int'];
}>;

export type ResetCurrentProjectMutation = {
  __typename?: 'Mutation';
  resetCurrentProject: boolean;
};

export type UpdateCurrentProjectMutationVariables = Types.Exact<{
  projectId: Types.Scalars['Int'];
  data: Types.UpdateCurrentProjectInput;
}>;

export type UpdateCurrentProjectMutation = {
  __typename?: 'Mutation';
  updateCurrentProject: boolean;
};

export const GetSettingsDocument = gql`
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

/**
 * __useGetSettingsQuery__
 *
 * To run a query within a React component, call `useGetSettingsQuery` and pass it any options that fit your needs.
 * When your component renders, `useGetSettingsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGetSettingsQuery({
 *   variables: {
 *      projectId: // value for 'projectId'
 *   },
 * });
 */
export function useGetSettingsQuery(
  baseOptions: Apollo.QueryHookOptions<
    GetSettingsQuery,
    GetSettingsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useQuery<GetSettingsQuery, GetSettingsQueryVariables>(
    GetSettingsDocument,
    options,
  );
}
export function useGetSettingsLazyQuery(
  baseOptions?: Apollo.LazyQueryHookOptions<
    GetSettingsQuery,
    GetSettingsQueryVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useLazyQuery<GetSettingsQuery, GetSettingsQueryVariables>(
    GetSettingsDocument,
    options,
  );
}
export type GetSettingsQueryHookResult = ReturnType<typeof useGetSettingsQuery>;
export type GetSettingsLazyQueryHookResult = ReturnType<
  typeof useGetSettingsLazyQuery
>;
export type GetSettingsQueryResult = Apollo.QueryResult<
  GetSettingsQuery,
  GetSettingsQueryVariables
>;
export const ResetCurrentProjectDocument = gql`
  mutation ResetCurrentProject($projectId: Int!) {
    resetCurrentProject(projectId: $projectId)
  }
`;
export type ResetCurrentProjectMutationFn = Apollo.MutationFunction<
  ResetCurrentProjectMutation,
  ResetCurrentProjectMutationVariables
>;

/**
 * __useResetCurrentProjectMutation__
 *
 * To run a mutation, you first call `useResetCurrentProjectMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useResetCurrentProjectMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [resetCurrentProjectMutation, { data, loading, error }] = useResetCurrentProjectMutation({
 *   variables: {
 *      projectId: // value for 'projectId'
 *   },
 * });
 */
export function useResetCurrentProjectMutation(
  baseOptions?: Apollo.MutationHookOptions<
    ResetCurrentProjectMutation,
    ResetCurrentProjectMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    ResetCurrentProjectMutation,
    ResetCurrentProjectMutationVariables
  >(ResetCurrentProjectDocument, options);
}
export type ResetCurrentProjectMutationHookResult = ReturnType<
  typeof useResetCurrentProjectMutation
>;
export type ResetCurrentProjectMutationResult =
  Apollo.MutationResult<ResetCurrentProjectMutation>;
export type ResetCurrentProjectMutationOptions = Apollo.BaseMutationOptions<
  ResetCurrentProjectMutation,
  ResetCurrentProjectMutationVariables
>;
export const UpdateCurrentProjectDocument = gql`
  mutation UpdateCurrentProject(
    $projectId: Int!
    $data: UpdateCurrentProjectInput!
  ) {
    updateCurrentProject(projectId: $projectId, data: $data)
  }
`;
export type UpdateCurrentProjectMutationFn = Apollo.MutationFunction<
  UpdateCurrentProjectMutation,
  UpdateCurrentProjectMutationVariables
>;

/**
 * __useUpdateCurrentProjectMutation__
 *
 * To run a mutation, you first call `useUpdateCurrentProjectMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateCurrentProjectMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateCurrentProjectMutation, { data, loading, error }] = useUpdateCurrentProjectMutation({
 *   variables: {
 *      projectId: // value for 'projectId'
 *      data: // value for 'data'
 *   },
 * });
 */
export function useUpdateCurrentProjectMutation(
  baseOptions?: Apollo.MutationHookOptions<
    UpdateCurrentProjectMutation,
    UpdateCurrentProjectMutationVariables
  >,
) {
  const options = { ...defaultOptions, ...baseOptions };
  return Apollo.useMutation<
    UpdateCurrentProjectMutation,
    UpdateCurrentProjectMutationVariables
  >(UpdateCurrentProjectDocument, options);
}
export type UpdateCurrentProjectMutationHookResult = ReturnType<
  typeof useUpdateCurrentProjectMutation
>;
export type UpdateCurrentProjectMutationResult =
  Apollo.MutationResult<UpdateCurrentProjectMutation>;
export type UpdateCurrentProjectMutationOptions = Apollo.BaseMutationOptions<
  UpdateCurrentProjectMutation,
  UpdateCurrentProjectMutationVariables
>;
