import React, { useState } from 'react';
import { 
  Table, 
  Button, 
  Space, 
  Modal, 
  Form, 
  Input, 
  message, 
  Typography, 
  Tag,
  Tooltip,
  Card
} from 'antd';
import { 
  EditOutlined, 
  DeleteOutlined, 
  CopyOutlined, 
  DatabaseOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  SwapOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import SiderLayout from '@/components/layouts/SiderLayout';
import { 
  useListProjectsQuery, 
  useSwitchProjectMutation,
  useUpdateProjectMutation,
  useDeleteProjectMutation,
  useDuplicateProjectMutation 
} from '@/apollo/client/graphql/projects.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';
import moment from 'moment';

const { Title, Text } = Typography;

export default function ProjectsPage() {
  const router = useRouter();
  const [editingProject, setEditingProject] = useState(null);
  const [duplicatingProject, setDuplicatingProject] = useState(null);
  const [form] = Form.useForm();
  
  const { data, loading, refetch } = useListProjectsQuery({
    fetchPolicy: 'cache-and-network',
  });
  
  const [switchProject] = useSwitchProjectMutation({
    onCompleted: () => {
      message.success('Project switched successfully');
      refetch();
      router.push(Path.Home);
    },
    onError: (error) => {
      message.error(`Failed to switch project: ${error.message}`);
    },
  });

  const [updateProject] = useUpdateProjectMutation({
    onCompleted: () => {
      message.success('Project updated successfully');
      setEditingProject(null);
      form.resetFields();
      refetch();
    },
    onError: (error) => {
      message.error(`Failed to update project: ${error.message}`);
    },
  });

  const [deleteProject] = useDeleteProjectMutation({
    onCompleted: () => {
      message.success('Project deleted successfully');
      refetch();
    },
    onError: (error) => {
      message.error(`Failed to delete project: ${error.message}`);
    },
  });

  const [duplicateProject] = useDuplicateProjectMutation({
    onCompleted: () => {
      message.success('Project duplicated successfully');
      setDuplicatingProject(null);
      form.resetFields();
      refetch();
    },
    onError: (error) => {
      message.error(`Failed to duplicate project: ${error.message}`);
    },
  });

  const projects = data?.listProjects?.projects || [];
  const activeProjectId = data?.listProjects?.activeProjectId;

  const handleSwitch = (projectId: number) => {
    if (projectId === activeProjectId) return;
    
    Modal.confirm({
      title: 'Switch Project',
      content: 'Are you sure you want to switch to this project?',
      onOk: () => {
        switchProject({ variables: { projectId } });
      },
    });
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    form.setFieldsValue({ name: project.name });
  };

  const handleUpdateSubmit = () => {
    form.validateFields().then((values) => {
      updateProject({
        variables: {
          projectId: editingProject.id,
          data: { name: values.name },
        },
      });
    });
  };

  const handleDelete = (project) => {
    if (project.id === activeProjectId) {
      message.error('Cannot delete the active project. Please switch to another project first.');
      return;
    }

    Modal.confirm({
      title: 'Delete Project',
      content: `Are you sure you want to delete "${project.name}"? This action cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        deleteProject({ variables: { projectId: project.id } });
      },
    });
  };

  const handleDuplicate = (project) => {
    setDuplicatingProject(project);
    form.setFieldsValue({ name: `${project.name} (Copy)` });
  };

  const handleDuplicateSubmit = () => {
    form.validateFields().then((values) => {
      duplicateProject({
        variables: {
          projectId: duplicatingProject.id,
          name: values.name,
        },
      });
    });
  };

  const getDataSourceColor = (type: DataSourceName) => {
    const colors = {
      [DataSourceName.POSTGRES]: 'blue',
      [DataSourceName.MYSQL]: 'orange',
      [DataSourceName.BIG_QUERY]: 'red',
      [DataSourceName.SNOWFLAKE]: 'cyan',
      [DataSourceName.REDSHIFT]: 'purple',
      [DataSourceName.DUCKDB]: 'green',
      // Add more as needed
    };
    return colors[type] || 'default';
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <Space>
          <DatabaseOutlined />
          <Text strong>{text}</Text>
          {record.id === activeProjectId && (
            <Tag icon={<CheckCircleOutlined />} color="success">Active</Tag>
          )}
          {record.sampleDataset && (
            <Tag color="blue">Sample Dataset</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Data Source',
      dataIndex: 'type',
      key: 'type',
      render: (type) => (
        <Tag color={getDataSourceColor(type)}>{type}</Tag>
      ),
    },
    {
      title: 'Display Name',
      dataIndex: 'displayName',
      key: 'displayName',
    },
    {
      title: 'Last Accessed',
      dataIndex: 'lastAccessedAt',
      key: 'lastAccessedAt',
      render: (date) => date ? moment(date).fromNow() : 'Never',
      sorter: (a, b) => moment(a.lastAccessedAt).unix() - moment(b.lastAccessedAt).unix(),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => moment(date).format('YYYY-MM-DD'),
      sorter: (a, b) => moment(a.createdAt).unix() - moment(b.createdAt).unix(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          {record.id !== activeProjectId && (
            <Tooltip title="Switch to this project">
              <Button
                type="link"
                icon={<SwapOutlined />}
                onClick={() => handleSwitch(record.id)}
              >
                Switch
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Edit project">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title="Duplicate project">
            <Button
              type="link"
              icon={<CopyOutlined />}
              onClick={() => handleDuplicate(record)}
            />
          </Tooltip>
          <Tooltip title="Delete project">
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
              disabled={record.id === activeProjectId}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <SiderLayout>
      <div style={{ padding: '24px' }}>
        <Card>
          <div style={{ marginBottom: 24 }}>
            <Title level={3}>Projects</Title>
            <Text type="secondary">
              Manage your projects and database connections. The active project is used for all operations.
            </Text>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                // Show a modal to get project name, then navigate to connection setup
                Modal.confirm({
                  title: 'Create New Project',
                  content: (
                    <div>
                      <p>You will be redirected to set up a new database connection.</p>
                      <p>Please enter a name for your new project:</p>
                      <Input 
                        id="new-project-name" 
                        placeholder="Enter project name" 
                        defaultValue="New Project"
                      />
                    </div>
                  ),
                  onOk: () => {
                    const nameInput = document.getElementById('new-project-name') as HTMLInputElement;
                    const projectName = nameInput?.value || 'New Project';
                    // Store the project name in sessionStorage to use during connection setup
                    sessionStorage.setItem('newProjectName', projectName);
                    router.push(Path.OnboardingConnection);
                  },
                });
              }}
            >
              New Project
            </Button>
          </div>

          <Table
            columns={columns}
            dataSource={projects}
            rowKey="id"
            loading={loading}
            pagination={false}
          />
        </Card>

        {/* Edit Project Modal */}
        <Modal
          title="Edit Project"
          open={!!editingProject}
          onOk={handleUpdateSubmit}
          onCancel={() => {
            setEditingProject(null);
            form.resetFields();
          }}
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

        {/* Duplicate Project Modal */}
        <Modal
          title="Duplicate Project"
          open={!!duplicatingProject}
          onOk={handleDuplicateSubmit}
          onCancel={() => {
            setDuplicatingProject(null);
            form.resetFields();
          }}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="New Project Name"
              rules={[
                { required: true, message: 'Please enter a project name' },
                { max: 50, message: 'Project name must be less than 50 characters' },
              ]}
            >
              <Input placeholder="Enter project name" />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </SiderLayout>
  );
}