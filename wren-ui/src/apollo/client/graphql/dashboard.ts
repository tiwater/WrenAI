import { gql } from '@apollo/client';

export const COMMON_DASHBOARD_ITEM = gql`
  fragment CommonDashboardItem on DashboardItem {
    id
    dashboardId
    type
    layout {
      x
      y
      w
      h
    }
    detail {
      sql
      chartSchema
    }
    displayName
  }
`;

export const DASHBOARD_ITEMS = gql`
  query DashboardItems($projectId: Int!) {
    dashboardItems(projectId: $projectId) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const CREATE_DASHBOARD_ITEM = gql`
  mutation CreateDashboardItem(
    $projectId: Int!
    $data: CreateDashboardItemInput!
  ) {
    createDashboardItem(projectId: $projectId, data: $data) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const UPDATE_DASHBOARD_ITEM = gql`
  mutation UpdateDashboardItem(
    $projectId: Int!
    $where: DashboardItemWhereInput!
    $data: UpdateDashboardItemInput!
  ) {
    updateDashboardItem(projectId: $projectId, where: $where, data: $data) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const UPDATE_DASHBOARD_ITEM_LAYOUTS = gql`
  mutation UpdateDashboardItemLayouts(
    $projectId: Int!
    $data: UpdateDashboardItemLayoutsInput!
  ) {
    updateDashboardItemLayouts(projectId: $projectId, data: $data) {
      ...CommonDashboardItem
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;

export const DELETE_DASHBOARD_ITEM = gql`
  mutation DeleteDashboardItem(
    $projectId: Int!
    $where: DashboardItemWhereInput!
  ) {
    deleteDashboardItem(projectId: $projectId, where: $where)
  }
`;

export const PREVIEW_ITEM_SQL = gql`
  mutation PreviewItemSQL($projectId: Int!, $data: PreviewItemSQLInput!) {
    previewItemSQL(projectId: $projectId, data: $data) {
      data
      cacheHit
      cacheCreatedAt
      cacheOverrodeAt
      override
    }
  }
`;

export const SET_DASHBOARD_SCHEDULE = gql`
  mutation SetDashboardSchedule(
    $projectId: Int!
    $data: SetDashboardScheduleInput!
  ) {
    setDashboardSchedule(projectId: $projectId, data: $data) {
      id
      projectId
      name
      cacheEnabled
      scheduleFrequency
      scheduleTimezone
      scheduleCron
      nextScheduledAt
    }
  }
`;

export const DASHBOARD = gql`
  query Dashboard($projectId: Int!) {
    dashboard(projectId: $projectId) {
      id
      name
      description
      cacheEnabled
      nextScheduledAt
      schedule {
        frequency
        hour
        minute
        day
        timezone
        cron
      }
      items {
        ...CommonDashboardItem
      }
    }
  }
  ${COMMON_DASHBOARD_ITEM}
`;
