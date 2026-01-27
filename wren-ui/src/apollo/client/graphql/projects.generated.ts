// This file will be auto-generated when running yarn generate-gql with the server running
// For now, providing functional hooks that use the GraphQL client

import { gql } from '@apollo/client';
import { useQuery, useMutation } from '@apollo/client';

const LIST_PROJECTS = gql`
  query ListProjects {
    listProjects {
      projects {
        id
        name
        displayName
        type
        language
        lastAccessedAt
        createdAt
        sampleDataset
      }
    }
  }
`;

export function useListProjectsQuery(options?: any) {
  return useQuery(LIST_PROJECTS, options);
}

export function useGetActiveProjectQuery(options?: any) {
  return {
    data: null,
    loading: false,
    refetch: () => Promise.resolve(),
  };
}

export function useGetProjectQuery(options?: any) {
  return {
    data: null,
    loading: false,
    refetch: () => Promise.resolve(),
  };
}

const CREATE_PROJECT = gql`
  mutation CreateProject($data: CreateProjectInput!) {
    createProject(data: $data) {
      id
      name
      displayName
      type
      language
      lastAccessedAt
      createdAt
      sampleDataset
    }
  }
`;

export function useCreateProjectMutation(options?: any) {
  return useMutation(CREATE_PROJECT, options);
}

const DELETE_PROJECT = gql`
  mutation DeleteProject($projectId: Int!) {
    deleteProject(projectId: $projectId)
  }
`;

const DUPLICATE_PROJECT = gql`
  mutation DuplicateProject($projectId: Int!, $name: String!) {
    duplicateProject(projectId: $projectId, name: $name) {
      id
      name
      displayName
      type
    }
  }
`;

const UPDATE_PROJECT = gql`
  mutation UpdateProject($projectId: Int!, $data: UpdateProjectInput!) {
    updateProject(projectId: $projectId, data: $data) {
      id
      name
      displayName
      type
    }
  }
`;

export function useDeleteProjectMutation(options?: any) {
  return useMutation(DELETE_PROJECT, options);
}

export function useDuplicateProjectMutation(options?: any) {
  return useMutation(DUPLICATE_PROJECT, options);
}

export function useUpdateProjectMutation(options?: any) {
  return useMutation(UPDATE_PROJECT, options);
}
