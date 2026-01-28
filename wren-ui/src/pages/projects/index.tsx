import React from 'react';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Card,
  message,
  Modal,
} from 'antd';
import {
  DatabaseOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  LoginOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/router';
import SiderLayout from '@/components/layouts/SiderLayout';
import {
  useListProjectsQuery,
  useDeleteProjectMutation,
} from '@/apollo/client/graphql/projects.generated';
import { DataSourceName } from '@/apollo/client/graphql/__types__';
import { Path } from '@/utils/enum';
import { useProject } from '@/contexts/ProjectContext';
import moment from 'moment';

const { Title, Text } = Typography;

export default function ProjectsPage() {
  const router = useRouter();
  const { selectedProjectId, setSelectedProjectId } = useProject();

  const { data, loading, refetch } = useListProjectsQuery({
    fetchPolicy: 'cache-and-network',
  });

  const [deleteProject] = useDeleteProjectMutation({
    onCompleted: async () => {
      message.success('Project deleted successfully');
      await refetch();
    },
    onError: (error) => {
      message.error(`Failed to delete project: ${error.message}`);
    },
  });

  const projects = data?.listProjects?.projects || [];

  const handleSelectProject = (projectId: number) => {
    setSelectedProjectId(projectId);
    message.success('Project selected successfully');
    router.push(Path.Home);
  };

  const handleCreateProject = () => {
    const projectName = prompt('Enter project name:');
    if (projectName) {
      // Store the project name in sessionStorage to use during connection setup
      sessionStorage.setItem('newProjectName', projectName);
      sessionStorage.setItem('creatingNewProject', 'true');
      router.push(Path.OnboardingConnection);
    }
  };

  const handleDeleteProject = (projectId: number, projectName: string) => {
    Modal.confirm({
      title: 'Are you sure you want to delete this project?',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            This will permanently delete project <strong>{projectName}</strong>{' '}
            and all its data, including:
          </p>
          <ul>
            <li>Models and relationships</li>
            <li>Views and calculated fields</li>
            <li>Thread history and queries</li>
            <li>All settings and configurations</li>
          </ul>
          <p>This action cannot be undone.</p>
        </div>
      ),
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      width: 520,
      onOk: async () => {
        const isCurrentProject = projectId === selectedProjectId;

        await deleteProject({ variables: { projectId } });

        // After deletion, handle project selection
        if (isCurrentProject) {
          const remainingProjects = projects.filter((p) => p.id !== projectId);

          if (remainingProjects.length > 0) {
            // Select the first remaining project
            const nextProject = remainingProjects[0];
            setSelectedProjectId(nextProject.id);
            message.info(`Switched to project: ${nextProject.name}`);
          } else {
            // No projects left, redirect to onboarding
            setSelectedProjectId(null);
            router.push(Path.OnboardingConnection);
          }
        }
      },
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
      [DataSourceName.ATHENA]: 'gold',
      [DataSourceName.ORACLE]: 'magenta',
      [DataSourceName.MSSQL]: 'volcano',
      [DataSourceName.CLICK_HOUSE]: 'lime',
      [DataSourceName.TRINO]: 'geekblue',
      [DataSourceName.DATABRICKS]: 'orange',
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
          {record.id === selectedProjectId && (
            <Tag icon={<CheckCircleOutlined />} color="success">
              Selected
            </Tag>
          )}
          {record.sampleDataset && (
            <Tag color="blue">Sample: {record.sampleDataset}</Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Data Source',
      dataIndex: 'type',
      key: 'type',
      render: (type) => <Tag color={getDataSourceColor(type)}>{type}</Tag>,
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
      render: (date) => (date ? moment(date).fromNow() : 'Never'),
      sorter: (a, b) => {
        const aTime = a.lastAccessedAt ? moment(a.lastAccessedAt).unix() : 0;
        const bTime = b.lastAccessedAt ? moment(b.lastAccessedAt).unix() : 0;
        return aTime - bTime;
      },
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date) => (date ? moment(date).format('YYYY-MM-DD') : 'Unknown'),
      sorter: (a, b) => {
        const aTime = a.createdAt ? moment(a.createdAt).unix() : 0;
        const bTime = b.createdAt ? moment(b.createdAt).unix() : 0;
        return aTime - bTime;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          {record.id !== selectedProjectId && (
            <Button
              type="primary"
              icon={<LoginOutlined />}
              onClick={() => handleSelectProject(record.id)}
              size="small"
            >
              Select
            </Button>
          )}
          {record.id === selectedProjectId && (
            <Button
              type="default"
              onClick={() => router.push(Path.Home)}
              size="small"
            >
              Go to Home
            </Button>
          )}
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteProject(record.id, record.name)}
            size="small"
          >
            Delete
          </Button>
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
              Select a project to work with or create a new one.
            </Text>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateProject}
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
      </div>
    </SiderLayout>
  );
}
