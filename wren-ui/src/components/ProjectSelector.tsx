import React, { useEffect, useState } from 'react';
import { Select, Space, Typography, Spin } from 'antd';
import { useListProjectsQuery } from '@/apollo/client/graphql/projects.generated';
import { useProject } from '@/contexts/ProjectContext';

const { Text } = Typography;
const { Option } = Select;

interface Project {
  id: number;
  displayName: string;
  type: string;
}

export const ProjectSelector: React.FC = () => {
  const { selectedProjectId, setSelectedProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);

  const { loading, data, error } = useListProjectsQuery({
    fetchPolicy: 'cache-and-network',
  });

  useEffect(() => {
    if (data?.listProjects?.projects) {
      setProjects(data.listProjects.projects);

      // If no project is selected and we have projects, select the first one
      if (!selectedProjectId && data.listProjects.projects.length > 0) {
        setSelectedProjectId(data.listProjects.projects[0].id);
      }
    }
  }, [data, selectedProjectId, setSelectedProjectId]);

  const handleProjectChange = (value: number) => {
    setSelectedProjectId(value);
    // Reload the page to refresh all data with new project
    window.location.reload();
  };

  if (loading && projects.length === 0) {
    return <Spin size="small" />;
  }

  if (error) {
    return <Text type="danger">Error loading projects</Text>;
  }

  if (projects.length === 0) {
    return <Text type="secondary">No projects available</Text>;
  }

  return (
    <Space>
      <Text>Project:</Text>
      <Select
        value={selectedProjectId}
        onChange={handleProjectChange}
        style={{ minWidth: 200 }}
        placeholder="Select a project"
      >
        {projects.map((project) => (
          <Option key={project.id} value={project.id}>
            {project.displayName} ({project.type})
          </Option>
        ))}
      </Select>
    </Space>
  );
};

export default ProjectSelector;
