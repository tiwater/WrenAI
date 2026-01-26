import React, { useEffect, useState } from 'react';
import { Select, Space, Typography, Spin } from 'antd';
import { useQuery } from '@apollo/client';
import { LIST_PROJECTS } from '@/apollo/client/graphql';
import { useProjectContext } from '@/contexts/ProjectContext';

const { Text } = Typography;
const { Option } = Select;

interface Project {
  id: number;
  displayName: string;
  type: string;
}

export const ProjectSelector: React.FC = () => {
  const { selectedProjectId, setSelectedProjectId } = useProjectContext();
  const [projects, setProjects] = useState<Project[]>([]);

  const { loading, data, error } = useQuery(LIST_PROJECTS, {
    fetchPolicy: 'cache-and-network',
  });

  useEffect(() => {
    if (data?.listProjects) {
      setProjects(data.listProjects);
      
      // If no project is selected and we have projects, select the first one
      if (!selectedProjectId && data.listProjects.length > 0) {
        setSelectedProjectId(data.listProjects[0].id);
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