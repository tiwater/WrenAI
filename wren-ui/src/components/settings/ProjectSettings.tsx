import { Button, Select, Row, Col, Form, message } from 'antd';
import { useUpdateCurrentProjectMutation } from '@/apollo/client/graphql/settings.generated';
import { getLanguageText } from '@/utils/language';
import { ProjectLanguage } from '@/apollo/client/graphql/__types__';
import { useOptionalSelectedProject } from '@/contexts/ProjectContext';

interface Props {
  data: { language: string };
}

export default function ProjectSettings(props: Props) {
  const { data } = props;
  const projectId = useOptionalSelectedProject();
  const [form] = Form.useForm();
  const languageOptions = Object.keys(ProjectLanguage).map((key) => {
    return { label: getLanguageText(key as ProjectLanguage), value: key };
  });

  const [updateCurrentProject, { loading }] = useUpdateCurrentProjectMutation({
    refetchQueries: ['GetSettings'],
    onError: (error) => console.error(error),
    onCompleted: () => {
      message.success('Successfully updated project language.');
    },
  });

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        if (!projectId) return;
        updateCurrentProject({ variables: { projectId, data: values } });
      })
      .catch((error) => console.error(error));
  };

  return (
    <div className="py-3 px-4">
      <Form
        form={form}
        layout="vertical"
        initialValues={{ language: data.language }}
      >
        <Form.Item
          label="Project language"
          extra="This setting will affect the language in which the AI responds to you."
        >
          <Row gutter={16} wrap={false}>
            <Col className="flex-grow-1">
              <Form.Item name="language" noStyle>
                <Select
                  placeholder="Select a language"
                  showSearch
                  options={languageOptions}
                />
              </Form.Item>
            </Col>
            <Col>
              <Button
                type="primary"
                style={{ width: 70 }}
                onClick={submit}
                loading={loading}
              >
                Save
              </Button>
            </Col>
          </Row>
        </Form.Item>
      </Form>
    </div>
  );
}
