import { gql } from '@apollo/client';

const INSTRUCTION = gql`
  fragment Instruction on Instruction {
    id
    projectId
    instruction
    questions
    isDefault
    createdAt
    updatedAt
  }
`;

export const LIST_INSTRUCTIONS = gql`
  query Instructions($projectId: Int!) {
    instructions(projectId: $projectId) {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const CREATE_INSTRUCTION = gql`
  mutation CreateInstruction($projectId: Int!, $data: CreateInstructionInput!) {
    createInstruction(projectId: $projectId, data: $data) {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const UPDATE_INSTRUCTION = gql`
  mutation UpdateInstruction(
    $projectId: Int!
    $where: InstructionWhereInput!
    $data: UpdateInstructionInput!
  ) {
    updateInstruction(projectId: $projectId, where: $where, data: $data) {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const DELETE_INSTRUCTION = gql`
  mutation DeleteInstruction($projectId: Int!, $where: InstructionWhereInput!) {
    deleteInstruction(projectId: $projectId, where: $where)
  }
`;
