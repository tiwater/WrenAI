import { useState } from 'react';
import { useGetSettingsQuery } from '@/apollo/client/graphql/settings.generated';
import { useGetNativeSqlLazyQuery } from '@/apollo/client/graphql/home.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { useOptionalSelectedProject } from '@/contexts/ProjectContext';
export interface NativeSQLResult {
  data: string;
  dataSourceType: DataSourceName;
  hasNativeSQL: boolean;
  loading: boolean;
  nativeSQLMode: boolean;
  setNativeSQLMode: (value: boolean) => void;
}

// we assume that not having a sample dataset means supporting native SQL
function useNativeSQLInfo(projectId: number | null) {
  const { data: settingsQueryResult } = useGetSettingsQuery({
    variables: { projectId: projectId! },
    skip: !projectId,
  });
  const settings = settingsQueryResult?.settings;
  const dataSourceType = settings?.dataSource.type;
  const sampleDataset = settings?.dataSource.sampleDataset;

  return {
    hasNativeSQL: !Boolean(sampleDataset),
    dataSourceType,
  };
}

export default function useNativeSQL() {
  const projectId = useOptionalSelectedProject();
  const nativeSQLInfo = useNativeSQLInfo(projectId);

  const [nativeSQLMode, setNativeSQLMode] = useState<boolean>(false);

  const [fetchNativeSQL, { data, loading }] = useGetNativeSqlLazyQuery({
    fetchPolicy: 'cache-and-network',
  });

  const fetchNativeSQLWithProject = (options: { variables: { responseId: number } }) => {
    return fetchNativeSQL({
      ...options,
      variables: {
        projectId: projectId!,
        ...options.variables,
      },
    });
  };

  const nativeSQL = data?.nativeSql || '';
  const nativeSQLResult: NativeSQLResult = {
    ...nativeSQLInfo,
    data: nativeSQL,
    loading,
    nativeSQLMode,
    setNativeSQLMode,
  };

  return {
    fetchNativeSQL: fetchNativeSQLWithProject,
    nativeSQLResult,
  };
}
