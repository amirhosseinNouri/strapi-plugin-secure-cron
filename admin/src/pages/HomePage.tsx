import {
  Alert,
  Badge,
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  IconButton,
  Switch,
  Table,
  Tbody,
  Td,
  TextButton,
  TFooter,
  Th,
  Thead,
  Tooltip,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { CaretDown, CaretUp, Pencil, Play, Plus, Trash } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { Page, useRBAC } from '@strapi/strapi/admin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CronJob } from '../../../types';
import { pluginBasePath } from '../../../utils/plugin';
import { useCronApi } from '../api/cron';
import { BlockedJobAlert, toBlockedJob, toWarnedJob, type BlockedJob } from '../components/BlockedJobAlert';
import { allPluginPermissions } from '../permissions';
import { formatUser } from '../utils/user';
import { PageLayout } from '../components/PageLayout';
import { getDateAndTimeString, getDateString } from '../utils/date';

export const HomePage: React.FunctionComponent = () => {
  const navigate = useNavigate();
  const api = useCronApi();
  const { allowedActions } = useRBAC(allPluginPermissions);
  const { canCreate, canUpdate, canDelete, canTrigger } = allowedActions;
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [sortKey, setSortKey] = useState<'name' | 'startDate' | 'endDate' | 'publicationDate'>(
    'name'
  );
  const [triggerStatus, setTriggerStatus] = useState<null | 'error' | 'success'>(null);
  const [blocked, setBlocked] = useState<BlockedJob | null>(null);
  const {
    isPending,
    data: cronJobs,
    refetch,
  } = useQuery({
    queryKey: ['cronJobs'],
    queryFn: () => api.getAllCronJobs(),
  });
  const deleteMutation = useMutation({
    mutationFn: api.deleteCronJob,
    onSuccess: () => {
      refetch();
    },
  });

  async function handleTriggerClick(cronJob: CronJob) {
    setBlocked(null);
    try {
      const result = await api.triggerCronJob(cronJob.documentId);
      setBlocked(toWarnedJob(cronJob, result.contentWarnings, 'trigger'));
      setTriggerStatus(result.success ? 'success' : 'error');
    } catch (error) {
      const reason = toBlockedJob(cronJob, error);
      if (reason) setBlocked(reason);
      setTriggerStatus('error');
    } finally {
      setTimeout(() => setTriggerStatus(null), 2000);
    }
  }

  async function handleEditClick(cronJob: CronJob) {
    navigate(`${pluginBasePath}/cron-jobs/edit/${cronJob.documentId}`);
  }

  async function handleDeleteClick(cronJob: CronJob) {
    const confirmation = confirm('This action will delete: ' + cronJob.name);
    if (!confirmation) return;
    deleteMutation.mutate(cronJob.documentId);
  }

  async function handleToggleChange(cronJob: CronJob) {
    const isPublished = !!cronJob.publicationDate;
    const message = isPublished
      ? 'This action will unpublish the cron job and reset its iterations count'
      : 'This action will publish the cron job';
    const confirmation = confirm(message);
    if (!confirmation) return;
    setBlocked(null);
    try {
      if (isPublished) {
        await api.unpublishCronJob(cronJob.documentId);
      } else {
        const result = await api.publishCronJob(cronJob.documentId);
        setBlocked(toWarnedJob(cronJob, result.contentWarnings, 'publish'));
      }
    } catch (error: any) {
      const reason = toBlockedJob(cronJob, error);
      if (reason) setBlocked(reason);
      else alert(error.message);
    }
    refetch();
  }

  function toggleSortOrder() {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  }

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      toggleSortOrder();
      return;
    }
    setSortOrder('asc');
    setSortKey(key);
  }

  const SortButton = (props: { sortKey: typeof sortKey }) => {
    let SortIcon = sortKey === props.sortKey && sortOrder === 'asc' ? <CaretUp /> : <CaretDown />;

    return (
      <Box marginLeft={2}>
        <IconButton variant={'ghost'} size="XS" onClick={(e: Event) => handleSort(props.sortKey)}>
          {SortIcon}
        </IconButton>
      </Box>
    );
  };

  const sortByCurrentKey = (a: CronJob, b: CronJob) => {
    const valueA = a[sortKey as keyof CronJob] ?? '';
    const valueB = b[sortKey as keyof CronJob] ?? '';

    if (sortOrder === 'asc') {
      return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
    } else {
      return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
    }
  };

  if (isPending) return <Page.Loading />;

  if (!cronJobs || cronJobs?.length === 0)
    return (
      <PageLayout title="Cron Jobs">
        <EmptyStateLayout
          icon={<EmptyDocuments style={{ width: '200px', height: '200px' }} />}
          content="You don't have any cron jobs yet..."
          action={
            canCreate ? (
              <Button
                startIcon={<Plus />}
                onClick={() => navigate(`${pluginBasePath}/cron-jobs/create`)}
              >
                Add new cron job
              </Button>
            ) : undefined
          }
        />
      </PageLayout>
    );

  return (
    <PageLayout title="Cron Jobs">
      {triggerStatus && (
        <TriggerAlert triggerStatus={triggerStatus} onClose={() => setTriggerStatus(null)} />
      )}
      {blocked && (
        <BlockedJobAlert
          blocked={blocked}
          onEdit={canUpdate ? () => handleEditClick(blocked.cronJob) : undefined}
          onClose={() => setBlocked(null)}
        />
      )}
      <Box marginBottom={8}>
        <Table
          rowCount={6}
          colCount={8}
          footer={
            canCreate ? (
              <TFooter
                onClick={() => {
                  navigate(`${pluginBasePath}/cron-jobs/create`);
                }}
                icon={<Plus />}
              >
                Add new cron job
              </TFooter>
            ) : undefined
          }
        >
          <Thead>
            <Tr>
              <Th action={<SortButton sortKey="name" />}>
                <Typography variant="sigma">Name</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Schedule</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Iterations</Typography>
              </Th>
              <Th action={<SortButton sortKey="startDate" />}>
                <Typography variant="sigma">Start Date</Typography>
              </Th>
              <Th action={<SortButton sortKey="endDate" />}>
                <Typography variant="sigma">End Date</Typography>
              </Th>
              <Th action={<SortButton sortKey="publicationDate" />}>
                <Typography variant="sigma">Status</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Last updated by</Typography>
              </Th>
              <Th action={null}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {cronJobs.sort(sortByCurrentKey).map((cronJob) => (
              <Tr key={cronJob.documentId}>
                <Td>
                  <TextButton
                    onClick={() => {
                      navigate(`${pluginBasePath}/cron-jobs/${cronJob.documentId}`);
                    }}
                  >
                    <Typography textColor="primary700">{cronJob.name}</Typography>
                  </TextButton>
                </Td>
                <Td>
                  <Typography textColor="neutral800">{cronJob.schedule}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral800">
                    {cronJob.iterationsLimit === -1 ? '∞' : cronJob.iterationsLimit}
                  </Typography>
                </Td>
                <Td>
                  <Tooltip label={getDateAndTimeString(cronJob.startDate)}>
                    <Typography textColor="neutral800">
                      {getDateString(cronJob.startDate)}
                    </Typography>
                  </Tooltip>
                </Td>
                <Td>
                  <Tooltip label={getDateAndTimeString(cronJob.endDate)}>
                    <Typography textColor="neutral800">{getDateString(cronJob.endDate)}</Typography>
                  </Tooltip>
                </Td>
                <Td>
                  {!cronJob.publicationDate ? (
                    <Badge>Draft</Badge>
                  ) : (
                    <Tooltip label={getDateAndTimeString(cronJob.publicationDate)}>
                      <Box>
                        <Badge active>Published</Badge>
                      </Box>
                    </Tooltip>
                  )}
                </Td>
                <Td>
                  <Tooltip
                    label={`Created by ${formatUser(cronJob.createdBy)} · Updated ${getDateAndTimeString(cronJob.updatedAt)}`}
                  >
                    <Typography textColor="neutral800">{formatUser(cronJob.updatedBy)}</Typography>
                  </Tooltip>
                </Td>
                <Td>
                  <Flex justifyContent="justify-evenly">
                    <Flex paddingLeft="10px" paddingRight="10px">
                      {canUpdate && (
                        <Box marginLeft={2}>
                          <IconButton
                            size="XS"
                            label="Edit"
                            onClick={() => handleEditClick(cronJob)}
                          >
                            <Pencil />
                          </IconButton>
                        </Box>
                      )}
                      {canDelete && (
                        <Box marginLeft={2}>
                          <IconButton
                            size="XS"
                            label="Delete"
                            onClick={() => handleDeleteClick(cronJob)}
                          >
                            <Trash />
                          </IconButton>
                        </Box>
                      )}
                      {canTrigger && (
                        <Box marginLeft={2}>
                          <IconButton
                            size="XS"
                            label="Test Run"
                            onClick={() => handleTriggerClick(cronJob)}
                          >
                            <Play />
                          </IconButton>
                        </Box>
                      )}
                    </Flex>
                    <Switch
                      label="Toggle"
                      checked={!!cronJob.publicationDate}
                      disabled={!canUpdate}
                      onCheckedChange={() => handleToggleChange(cronJob)}
                    />
                  </Flex>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </PageLayout>
  );
};

const TriggerAlert = ({
  triggerStatus,
  onClose,
}: {
  triggerStatus: null | 'error' | 'success';
  onClose: () => void;
}) => {
  if (!triggerStatus) return null;

  const variant = {
    success: 'success',
    error: 'danger',
  }[triggerStatus];

  const message = {
    success: 'Success',
    error: 'Error',
  }[triggerStatus];

  return (
    <Box
      style={{
        width: '100%',
        position: 'fixed',
        top: 20,
        left: 0,
        zIndex: 10,
      }}
    >
      <Flex direction="column" alignItems="center">
        <Alert closeLabel="Close" title="Test Run:" variant={variant} onClose={onClose}>
          {message}
        </Alert>
      </Flex>
    </Box>
  );
};
