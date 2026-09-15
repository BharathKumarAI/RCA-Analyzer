import type {
  ConnectorTemplateItem,
  ConnectorAuthProfileItem,
  GovernanceTier,
} from '../../types/api';

export interface FieldMappingItem {
  id: string;
  sourceField: string;
  fieldType: string;
  targetField: string;
  required: boolean;
  defaultValue: string;
}

export interface ConnectorAuthProfilesCardProps {
  authProfiles: (Partial<ConnectorAuthProfileItem> & { id: string; name: string; status?: string })[];
  selectedProfileId?: string;
  onSelectProfile?: (id: string) => void;
  connectorType?: string;
  /** Native provider implementations that can be tested by this deployment. */
  selectableProfileIds?: string[];
  readOnly?: boolean;
}

export interface ConnectorGovernanceCardProps {
  supportedOperations?: string[];
  isPolicyBlocked?: boolean;
  policyMessage?: string;
  governanceTier?: GovernanceTier;
  readAccessRole?: string;
  writeAccessRole?: string;
}

export interface JiraFieldMappingCardProps {
  connectorName?: string;
  mappings: FieldMappingItem[];
  onChange: (mappings: FieldMappingItem[]) => void;
  onDiscover?: () => Promise<void>;
  isDiscovering?: boolean;
  readOnly?: boolean;
}

export interface ConnectorExecutionLimitsCardProps {
  timeoutSeconds: number;
  onTimeoutChange: (val: number) => void;
  timeoutDefault?: number;
  retryAttempts?: number;
  onRetryAttemptsChange?: (val: number) => void;
  retryAttemptsDefault?: number;
  retryBackoff?: number;
  onRetryBackoffChange?: (val: number) => void;
  retryBackoffDefault?: number;
  rateLimit?: number;
  onRateLimitChange?: (val: number) => void;
  rateLimitDefault?: number;
  maxResponseBytes?: number;
  onMaxResponseBytesChange?: (val: number) => void;
  maxBytesDefault?: number;
  hasMaxResponseBytes?: boolean;
  readOnly?: boolean;
}

export interface ConnectorSpecificFieldsProps {
  connectorType: string;
  // Jira fields
  customJql?: string;
  onCustomJqlChange?: (val: string) => void;
  attachmentProcessing?: string;
  onAttachmentProcessingChange?: (val: string) => void;
  jiraProjectKey?: string;
  onJiraProjectKeyChange?: (val: string) => void;
  // Splunk fields
  splunkIndex?: string;
  onSplunkIndexChange?: (val: string) => void;
  searchWindowSeconds?: number;
  onSearchWindowSecondsChange?: (val: number) => void;
  maxResults?: number;
  onMaxResultsChange?: (val: number) => void;
  // Unix fields
  unixLogPath?: string;
  onUnixLogPathChange?: (val: string) => void;
  sshPort?: number;
  onSshPortChange?: (val: number) => void;
  // Kafka fields
  kafkaTopicFilter?: string;
  onKafkaTopicFilterChange?: (val: string) => void;
  kafkaTopics?: string[];
  // Oracle fields
  oracleDriverMode?: string;
  onOracleDriverModeChange?: (val: string) => void;
  oracleClientLibDir?: string;
  onOracleClientLibDirChange?: (val: string) => void;
  oracleConnectionFormat?: string;
  onOracleConnectionFormatChange?: (val: string) => void;
  // Scope / Evidence fields
  scopeValue?: string;
  onScopeValueChange?: (val: string) => void;
  readOnly?: boolean;
}
