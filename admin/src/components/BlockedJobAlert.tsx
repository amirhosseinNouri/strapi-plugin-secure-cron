import { Alert, Badge, Box, Button, Flex, Link, Typography } from '@strapi/design-system';
import type { ContentFinding, CronJob, SecurityCheckResult } from '../../../types';
import { ApiError } from '../api/cron';
import { SecurityFindings } from './ScriptEditor';

export type BlockedJob = {
  cronJob: CronJob;
  message: string;
  securityResult: SecurityCheckResult | null;
  contentFindings: ContentFinding[];
};

/** Turns a 422 from publish/trigger into what the user must fix, or null for any other error. */
export const toBlockedJob = (cronJob: CronJob, error: unknown): BlockedJob | null => {
  if (!(error instanceof ApiError)) return null;
  if (error.name === 'SecurityCheckError') {
    const findings = error.details.findings ?? [];
    const errors = findings.filter((finding) => finding.severity === 'error').length;
    return {
      cronJob,
      message: error.message,
      securityResult: { enabled: true, passed: errors === 0, errors, warnings: findings.length - errors, findings },
      contentFindings: [],
    };
  }
  if (error.name === 'PublishGuardError') {
    return { cronJob, message: error.message, securityResult: null, contentFindings: error.details.contentFindings ?? [] };
  }
  return null;
};

type Props = {
  blocked: BlockedJob;
  onEdit?: () => void;
  onClose: () => void;
};

export const BlockedJobAlert = ({ blocked, onEdit, onClose }: Props) => (
  <Box marginBottom={6} data-testid="blocked-job">
    <Alert variant="danger" title={`"${blocked.cronJob.name}" was not turned on`} closeLabel="Close" onClose={onClose}>
      {blocked.message}
    </Alert>
    <Box padding={4} background="neutral0" hasRadius shadow="tableShadow" marginTop={2}>
      <SecurityFindings result={blocked.securityResult} />
      {blocked.contentFindings.length > 0 && (
        <Box as="ul">
          {blocked.contentFindings.map((finding, index) => (
            <Flex as="li" key={`${finding.message}-${index}`} gap={2} paddingBottom={1} alignItems="flex-start">
              <Badge
                backgroundColor={finding.severity === 'error' ? 'danger100' : 'warning100'}
                textColor={finding.severity === 'error' ? 'danger700' : 'warning700'}
              >
                {finding.severity}
              </Badge>
              <Typography variant="pi" textColor="neutral800">
                {finding.message}
              </Typography>
              {finding.link && (
                <Link href={finding.link} isExternal={false}>
                  Open
                </Link>
              )}
            </Flex>
          ))}
        </Box>
      )}
      {onEdit && (
        <Box paddingTop={3}>
          <Button variant="secondary" onClick={onEdit}>
            Edit script
          </Button>
        </Box>
      )}
    </Box>
  </Box>
);
