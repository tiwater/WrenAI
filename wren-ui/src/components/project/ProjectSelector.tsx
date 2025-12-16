import React, { useState } from 'react';
import { Select, Button, Space, Modal, Form, Input, message, Tag } from 'antd';
import { PlusOutlined, DatabaseOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useRouter } from 'next/router';
import { 
  useListProjectsQuery, 
  useSwitchProjectMutation,
  useCreateProjectMutation 
} from '@/apollo/client/graphql/projects.generated';
import { Path } from '@/utils/enum';
import { DataSourceName } from '@/apollo/client/graphql/__types__';

const { Option } = Select;

interface ProjectSelectorProps {
  className?: string;
}

export default function ProjectSelector({ className }: ProjectSelectorProps) {
  const router = useRouter();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  
  const { data, loading, refetch } = useListProjectsQuery({
    fetchPolicy: 'cache-and-network',
  });
  
  const [switchProject, { loading: switchingProject }] = useSwitchProjectMutation({
    onCompleted: () => {
      message.success('Project switched successfully');
      refetch();
      // Refresh the page to reload context
      router.reload();
    },
    onError: (error) => {
      message.error(`Failed to switch project: ${error.message}`);
    },
  });

  const [createProject] = useCreateProjectMutation({
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
    if (projectId === data?.listProjects?.activeProjectId) return;
    
    Modal.confirm({
      title: 'Switch Project',
      content: 'Are you sure you want to switch to this project? Any unsaved changes will be lost.',
      onOk: () => {
        switchProject({ variables: { projectId } });
      },
    });
  };

  const handleCreateProject = () => {
    form.validateFields().then((values) => {
      createProject({
        variables: {
          data: {
            name: values.name,
            type: DataSourceName.POSTGRES, // Default type, will be updated in connection setup
            properties: {
              displayName: values.name,
            },
          },
        },
      });
    });
  };

  const projects = data?.listProjects?.projects || [];
  const activeProjectId = data?.listProjects?.activeProjectId;
  const activeProject = projects.find(p => p.id === activeProjectId);

  const getDataSourceIcon = (type: DataSourceName) => {
    // You can add more specific icons for different data sources
    return <DatabaseOutlined />;
  };

  return (
    <>
      <Space className={className}>
        <Select
          style={{ minWidth: 200 }}
          value={activeProjectId}
          onChange={handleProjectChange}
          loading={loading || switchingProject}
          placeholder="Select a project"
          suffixIcon={<DatabaseOutlined />}
        >
          {projects.map((project) => (
            <Option key={project.id} value={project.id}>
              <Space>
                {getDataSourceIcon(project.type)}
                <span>{project.name}</span>
                {project.id === activeProjectId && (
                  <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 4 }} />
                )}
                {project.sampleDataset && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>Sample</Tag>
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
        open={isModalVisible}
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
              { max: 50, message: 'Project name must be less than 50 characters' },
            ]}
          >
            <Input placeholder="Enter project name" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}