import React, { useState, useEffect } from 'react';
import { Select, Button, Space, Modal, Form, Input, message, Tag } from 'antd';
import {
  PlusOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import {
  useListProjectsQuery,
  useCreateProjectMutation,
} from '@/apollo/client/graphql/projects.generated';
import { Path } from '@/utils/enum';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { useProject } from '@/contexts/ProjectContext';

const { Option } = Select;

interface ProjectSelectorProps {
  className?: string;
}

export default function ProjectSelector({ className }: ProjectSelectorProps) {
  const router = useRouter();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const { selectedProjectId, setSelectedProjectId } = useProject();

  const { data, loading, refetch } = useListProjectsQuery({
    fetchPolicy: 'cache-and-network',
  });

  // Set initial selected project if not set
  useEffect(() => {
    if (!selectedProjectId && data?.listProjects?.projects?.length > 0) {
      const firstProject = data.listProjects.projects[0];
      setSelectedProjectId(firstProject.id);
    }
  }, [data, selectedProjectId, setSelectedProjectId]);

  const [_createProject] = useCreateProjectMutation({
    onCompleted: () => {
      message.success('Project created successfully');
      setIsModalVisible(false);
      form.resetFields();
      refetch();
      // Navigate to connection setup for new project
      router.push(Path.OnboardingConnection);
    },
    onError: (error) => {
      message.error(`Failed to create project: ${error.message}`);
    },
  });

  const handleProjectChange = (projectId: number) => {
    if (projectId === selectedProjectId) return;

    Modal.confirm({
      title: 'Switch Project',
      content:
        'Are you sure you want to switch to this project? Any unsaved changes will be lost.',
      onOk: () => {
        setSelectedProjectId(projectId);
        // Update last accessed time for the new project
        // This will be handled by the resolver when queries are made with this projectId
        message.success('Project switched successfully');
        // Refresh the page to load new project data
        router.reload();
      },
    });
  };

  const handleCreateProject = () => {
    form.validateFields().then((values) => {
      // Don't create project immediately, pass name to setup flow
      sessionStorage.setItem('newProjectName', values.name);
      sessionStorage.setItem('creatingNewProject', 'true');
      setIsModalVisible(false);
      form.resetFields();
      router.push(Path.OnboardingConnection);
    });
  };

  const projects = data?.listProjects?.projects || [];

  const getDataSourceIcon = (_type: DataSourceName) => {
    // You can add more specific icons for different data sources
    return <DatabaseOutlined />;
  };

  return (
    <>
      <Space className={className}>
        <Select
          style={{ minWidth: 200 }}
          value={selectedProjectId}
          onChange={handleProjectChange}
          loading={loading}
          placeholder="Select a project"
          suffixIcon={<DatabaseOutlined />}
        >
          {projects.map((project) => (
            <Option key={project.id} value={project.id}>
              <Space>
                {getDataSourceIcon(project.type)}
                <span>{project.name}</span>
                {project.id === selectedProjectId && (
                  <CheckCircleOutlined
                    style={{ color: '#52c41a', marginLeft: 4 }}
                  />
                )}
                {project.sampleDataset && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    Sample
                  </Tag>
                )}
              </Space>
            </Option>
          ))}
        </Select>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setIsModalVisible(true)}
          type="text"
        >
          New Project
        </Button>
      </Space>

      <Modal
        title="Create New Project"
        visible={isModalVisible}
        onOk={handleCreateProject}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        okText="Create"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Project Name"
            rules={[
              { required: true, message: 'Please enter a project name' },
              {
                max: 50,
                message: 'Project name must be less than 50 characters',
              },
            ]}
          >
            <Input placeholder="Enter project name" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
