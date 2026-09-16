import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Sliders,
  RefreshCw,
  Search,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Lock,
  Key,
  Database,
  Cpu,
  Layers,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  X,
  Shield,
  Clock,
  Sparkles,
  Code,
  Info,
  Check,
  ToggleLeft,
  ToggleRight,
  List,
  Grid,
  Copy,
  Boxes,
  Plus,
  Trash2,
  Filter,
  Tag,
  HelpCircle
} from 'lucide-react';
import { NotificationBanner } from '../components/NotificationBanner';
import {
  defineParameter,
  deleteParameterDefinition,
  fetchParameters,
  fetchConnectorTemplates,
  fetchParameterTaxonomy,
  fetchPrincipal,
  resetParameterOverride,
  setParameterOverride,
  saveConnectorFieldGovernance,
  ApiError
} from '../services/api';
import {
  KNOWN_PARAMETER_CATEGORIES,
  type ParameterDefinitionRow,
  type ParameterEffectiveState,
  type ParameterScope,
  type Principal,
  type ConnectorValueType,
  type ConnectorTemplateItem,
  type GovernanceTier
} from '../types/api';
import {
  parseNumericValue,
  parseTypedValue,
  valuesMatch,
  areAllowedValuesScalar
} from '../utils/parameterValues';
import '../styles/parameters.css';

// Format helpers
const parameterKey = (item: ParameterDefinitionRow) => `${item.tool}.${item.variable_name}`;

const displayValue = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatValueType = (valueType: ParameterDefinitionRow['value_type']) =>
  valueType.replace(/_/g, ' ');

interface ToolMeta {
  displayName: string;
  toolCategory: string;
  description: string;
  icon: React.ReactNode;
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  runtime: <Cpu size={16} />,
  itsm: <Layers size={16} />,
  log_search: <Search size={16} />,
};

function getToolMeta(toolName: string, templates: ConnectorTemplateItem[]): ToolMeta {
  const template = templates.find(item => item.system_name === toolName);
  const formatted = toolName
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
  return {
    displayName: template?.name || formatted,
    toolCategory: template?.category || '',
    description: template?.description || '',
    icon: TOOL_ICONS[toolName] || <Sliders size={16} />,
  };
}

export function ParameterStudio() {
  const [parameters, setParameters] = useState<ParameterDefinitionRow[]>([]);
  const [templates, setTemplates] = useState<ConnectorTemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingGovernance, setSavingGovernance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Dynamic taxonomy from backend
  const [taxonomyMap, setTaxonomyMap] = useState<Record<string, string[]>>(() => ({
    ...KNOWN_PARAMETER_CATEGORIES as unknown as Record<string, string[]>,
  }));

  // User Principal & Roles
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canOverride, setCanOverride] = useState(false);

  // View Mode: Table (default) vs Cards
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Filters & Taxonomy Navigation
  const [selectedTool, setSelectedTool] = useState<string>('ALL');
  const [providerSearch, setProviderSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | ParameterScope>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('ALL');
  const [effectiveStateFilter, setEffectiveStateFilter] = useState<'ALL' | ParameterEffectiveState>('ALL');
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({});
  const [showTaxonomyGuide, setShowTaxonomyGuide] = useState(false);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inspector / Drawer State
  const [activeParam, setActiveParam] = useState<ParameterDefinitionRow | null>(null);
  const [drawerTab, setDrawerTab] = useState<'override' | 'platform_default' | 'details'>('override');

  // Add Parameter Dialog State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTool, setNewTool] = useState('runtime');
  const [newCustomTool, setNewCustomTool] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ConnectorValueType>('string');
  const [newCategory, setNewCategory] = useState<string>('connectivity');
  const [newSubcategory, setNewSubcategory] = useState<string>('endpoint');
  const [newAllowedValues, setNewAllowedValues] = useState<string[]>([]);
  const [newAllowedValueInput, setNewAllowedValueInput] = useState<string>('');
  const [newDefaultValue, setNewDefaultValue] = useState('');
  const [newDefaultBool, setNewDefaultBool] = useState(false);
  const [newDefaultNumber, setNewDefaultNumber] = useState(0);
  const [newDescription, setNewDescription] = useState('');
  const [newScope, setNewScope] = useState<ParameterScope>('project');
  const [addError, setAddError] = useState<string | null>(null);

  // Edit fields for Project Override
  const [editOverrideValue, setEditOverrideValue] = useState<string>('');
  const [editOverrideBool, setEditOverrideBool] = useState<boolean>(false);
  const [editOverrideNumber, setEditOverrideNumber] = useState<number>(0);
  const [overrideJsonError, setOverrideJsonError] = useState<string | null>(null);

  // Edit fields for Platform Default
  const [editDefaultValue, setEditDefaultValue] = useState<string>('');
  const [editDefaultBool, setEditDefaultBool] = useState<boolean>(false);
  const [editDefaultNumber, setEditDefaultNumber] = useState<number>(0);
  const [editDescription, setEditDescription] = useState<string>('');
  const [editAllowOverride, setEditAllowOverride] = useState<boolean>(false);
  const [editScope, setEditScope] = useState<ParameterScope>('platform_only');
  const [editCategory, setEditCategory] = useState<string>('connectivity');
  const [editSubcategory, setEditSubcategory] = useState<string>('');
  const [editAllowedValues, setEditAllowedValues] = useState<string[]>([]);
  const [editAllowedValueInput, setEditAllowedValueInput] = useState<string>('');
  const [editEnabled, setEditEnabled] = useState<boolean>(true);
  const [defaultJsonError, setDefaultJsonError] = useState<string | null>(null);

  const getSubcategories = useCallback((cat: string, includeSubcategory?: string): string[] => {
    const options = new Set<string>(taxonomyMap[cat] ?? []);
    for (const item of parameters) {
      if (item.category === cat && item.subcategory) {
        options.add(item.subcategory);
      }
    }
    if (includeSubcategory && !options.has(includeSubcategory)) {
      options.add(includeSubcategory);
    }
    return Array.from(options).sort();
  }, [taxonomyMap, parameters]);

  const getInitialSubcategory = (category: string): string => {
    const list = getSubcategories(category);
    return list[0] || '';
  };

  const setNewTypeDefaults = (type: ConnectorValueType) => {
    setNewDefaultBool(false);
    setNewDefaultNumber(0);
    if (type === 'boolean') {
      setNewDefaultBool(false);
      setNewDefaultValue('false');
    } else if (type === 'json') {
      setNewDefaultValue('{}');
    } else if (type === 'secret_ref') {
      setNewDefaultValue('env://');
    } else {
      setNewDefaultValue('');
    }
  };

  const resetNewParameterForm = (overrides: { tool?: string } = {}) => {
    setAddError(null);
    setNewTool(overrides.tool || 'runtime');
    setNewCustomTool('');
    setNewName('');
    setNewType('string');
    setNewCategory('connectivity');
    setNewSubcategory(getInitialSubcategory('connectivity'));
    setNewAllowedValues([]);
    setNewAllowedValueInput('');
    setNewDescription('');
    setNewScope('project');
    setNewDefaultBool(false);
    setNewDefaultNumber(0);
    setNewDefaultValue('');
  };

  // Load Data
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, publishedTemplates] = await Promise.all([
        fetchParameters(),
        fetchConnectorTemplates('published').catch(() => null),
      ]);
      setParameters(items);
      setTemplates(publishedTemplates || []);
      if (!publishedTemplates) setError('Connector names could not load. Showing parameter tool keys instead; reload to retry.');
      if (activeParam) {
        const updated = items.find(i => parameterKey(i) === parameterKey(activeParam));
        if (updated) setActiveParam(updated);
      }
      return Boolean(publishedTemplates);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to load parameter catalog from deployment.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [activeParam]);

  useEffect(() => {
    void load();
    fetchPrincipal()
      .then(p => {
        setPrincipal(p);
        const roles = p.roles || [];
        const isAdm = roles.includes('PLATFORM_ADMIN');
        setIsPlatformAdmin(isAdm);
        setCanOverride(isAdm || roles.includes('PROJECT_OWNER'));
      })
      .catch(() => {
        setIsPlatformAdmin(false);
        setCanOverride(false);
      });

    fetchParameterTaxonomy()
      .then(taxMap => {
        if (taxMap && Object.keys(taxMap).length > 0) {
          setTaxonomyMap(taxMap);
        }
      })
      .catch(() => null);
  }, []);

  // Keyboard shortcut listener for ESC (close modal or drawer)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAddOpen) {
          resetNewParameterForm();
          setIsAddOpen(false);
        } else if (activeParam) {
          setActiveParam(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeParam, isAddOpen]);

  // Sync edit state whenever activeParam changes
  useEffect(() => {
    if (!activeParam) return;
    setOverrideJsonError(null);
    setDefaultJsonError(null);

    // Populate Override fields
    if (activeParam.value_type === 'boolean') {
      const boolValue = Boolean(activeParam.effective_value);
      setEditOverrideBool(boolValue);
      setEditOverrideValue(boolValue ? 'true' : 'false');
    } else if (activeParam.value_type === 'integer' || activeParam.value_type === 'number') {
      setEditOverrideNumber(Number(activeParam.effective_value) || 0);
      setEditOverrideValue(String(activeParam.effective_value ?? '0'));
    } else {
      setEditOverrideValue(displayValue(activeParam.effective_value));
    }

    // Populate Platform Default fields
    setEditDescription(activeParam.description || '');
    const currentScope = activeParam.scope || (activeParam.allow_project_override ? 'project' : 'platform_only');
    setEditScope(currentScope);
    setEditAllowOverride(currentScope === 'project');
    setEditCategory(activeParam.category || 'connectivity');
    setEditSubcategory(activeParam.subcategory || '');
    setEditEnabled(activeParam.enabled !== false);

    const allowedStrs = Array.isArray(activeParam.allowed_values)
      ? activeParam.allowed_values.map(v => (typeof v === 'string' ? v : JSON.stringify(v)))
      : [];
    setEditAllowedValues(allowedStrs);
    setEditAllowedValueInput('');

    if (activeParam.value_type === 'boolean') {
      setEditDefaultBool(Boolean(activeParam.default_value));
    } else if (activeParam.value_type === 'integer' || activeParam.value_type === 'number') {
      setEditDefaultNumber(Number(activeParam.default_value) || 0);
      setEditDefaultValue(String(activeParam.default_value ?? '0'));
    } else {
      setEditDefaultValue(displayValue(activeParam.default_value));
    }

    // Default tab based on permissions
    if (activeParam.allow_project_override && activeParam.enabled !== false && activeParam.effective_state !== 'DISABLED') {
      setDrawerTab('override');
    } else if (isPlatformAdmin) {
      setDrawerTab('platform_default');
    } else {
      setDrawerTab('details');
    }
  }, [activeParam, isPlatformAdmin]);

  // Group parameters by tool
  const toolsMap = useMemo(() => {
    const map = new Map<string, ParameterDefinitionRow[]>();
    for (const item of parameters) {
      const list = map.get(item.tool) || [];
      list.push(item);
      map.set(item.tool, list);
    }
    return map;
  }, [parameters]);

  const uniqueTools = useMemo(() => {
    return Array.from(toolsMap.keys()).sort();
  }, [toolsMap]);

  // Unique categories across loaded parameters and backend taxonomy
  const availableCategories = useMemo(() => {
    const cats = new Set<string>(Object.keys(taxonomyMap));
    for (const p of parameters) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats).sort();
  }, [parameters, taxonomyMap]);

  // Contextual subcategories for categoryFilter
  const availableSubcategories = useMemo(() => {
    if (categoryFilter === 'ALL') {
      const subcats = new Set<string>();
      for (const p of parameters) {
        if (p.subcategory) subcats.add(p.subcategory);
      }
      return Array.from(subcats).sort();
    }
    return getSubcategories(categoryFilter);
  }, [parameters, categoryFilter, getSubcategories]);

  // Filtered providers for sidebar search
  const filteredSidebarTools = useMemo(() => {
    if (!providerSearch.trim()) return uniqueTools;
    const q = providerSearch.toLowerCase();
    return uniqueTools.filter(t => {
      const meta = getToolMeta(t, templates);
      return t.toLowerCase().includes(q) || meta.displayName.toLowerCase().includes(q);
    });
  }, [uniqueTools, providerSearch, templates]);

  // Overall Statistics
  const stats = useMemo(() => {
    const total = parameters.length;
    const toolsCount = uniqueTools.length;
    const overridden = parameters.filter(p => p.override_revision !== null && p.override_revision > 0).length;
    const platformEnforced = parameters.filter(
      p => !p.allow_project_override || p.scope === 'platform_only' || p.enabled === false
    ).length;
    const set = parameters.filter(p => p.effective_state === 'SET').length;
    const inherit = parameters.filter(p => p.effective_state === 'INHERIT').length;
    const disabled = parameters.filter(p => p.effective_state === 'DISABLED' || p.enabled === false).length;
    return { total, toolsCount, overridden, platformEnforced, set, inherit, disabled };
  }, [parameters, uniqueTools]);

  // Filtered parameters
  const filteredParameters = useMemo(() => {
    return parameters.filter(item => {
      // Tool filter
      if (selectedTool !== 'ALL' && item.tool !== selectedTool) {
        return false;
      }
      // Value type filter
      if (typeFilter !== 'ALL' && item.value_type !== typeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter === 'OVERRIDDEN' && (!item.override_revision || item.override_revision <= 0)) {
        return false;
      }
      if (statusFilter === 'DEFAULT' && item.override_revision && item.override_revision > 0) {
        return false;
      }
      if (
        statusFilter === 'CAN_OVERRIDE' &&
        (!item.allow_project_override || item.enabled === false || item.effective_state === 'DISABLED')
      ) {
        return false;
      }
      if (
        statusFilter === 'LOCKED' &&
        item.allow_project_override &&
        item.enabled !== false &&
        item.effective_state !== 'DISABLED'
      ) {
        return false;
      }
      // Scope filter
      if (scopeFilter !== 'ALL' && item.scope !== scopeFilter) {
        return false;
      }
      // Category filter
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) {
        return false;
      }
      // Subcategory filter
      if (subcategoryFilter !== 'ALL' && item.subcategory !== subcategoryFilter) {
        return false;
      }
      // Effective State filter
      if (effectiveStateFilter !== 'ALL') {
        const itemState = item.effective_state || (item.enabled === false ? 'DISABLED' : 'SET');
        if (itemState !== effectiveStateFilter) {
          return false;
        }
      }
      // Search query across variable_name, description, main, tool, category, subcategory, effective_value
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const key = parameterKey(item).toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const toolName = getToolMeta(item.tool, templates).displayName.toLowerCase();
        const main = (item.main || item.tool).toLowerCase();
        const cat = (item.category || '').toLowerCase();
        const subcat = (item.subcategory || '').toLowerCase();
        const effVal = displayValue(item.effective_value).toLowerCase();
        const defVal = displayValue(item.default_value).toLowerCase();
        if (
          !key.includes(q) &&
          !desc.includes(q) &&
          !toolName.includes(q) &&
          !main.includes(q) &&
          !cat.includes(q) &&
          !subcat.includes(q) &&
          !effVal.includes(q) &&
          !defVal.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    parameters,
    selectedTool,
    typeFilter,
    statusFilter,
    scopeFilter,
    categoryFilter,
    subcategoryFilter,
    effectiveStateFilter,
    searchQuery,
    templates,
  ]);

  // Group filtered parameters by tool -> category
  const filteredToolsMap = useMemo(() => {
    const map = new Map<string, Map<string, ParameterDefinitionRow[]>>();
    for (const item of filteredParameters) {
      const toolCatMap = map.get(item.tool) || new Map<string, ParameterDefinitionRow[]>();
      const catKey = item.category || 'operational';
      const list = toolCatMap.get(catKey) || [];
      list.push(item);
      toolCatMap.set(catKey, list);
      map.set(item.tool, toolCatMap);
    }
    return map;
  }, [filteredParameters]);

  const toggleCollapseTool = (tool: string) => {
    setCollapsedTools(prev => ({ ...prev, [tool]: !prev[tool] }));
  };

  const setAllCollapsed = (collapsed: boolean) => {
    const next: Record<string, boolean> = {};
    for (const t of uniqueTools) {
      next[t] = collapsed;
    }
    setCollapsedTools(next);
  };

  // Helper to parse input values
  const parseInputValue = (type: ConnectorValueType, rawString: string, rawBool: boolean, rawNum: number): unknown => {
    if (type === 'boolean') return Boolean(rawBool);
    if (type === 'integer') {
      return parseNumericValue(rawNum, rawString, true);
    }
    if (type === 'number') {
      return parseNumericValue(rawNum, rawString, false);
    }
    if (type === 'string') return rawString;
    if (type === 'secret_ref') {
      return parseTypedValue(rawString, 'secret_ref');
    }
    if (type === 'json') {
      return parseTypedValue(rawString, 'json');
    }
    return rawString;
  };

  // Copy to clipboard helper
  const handleCopyValue = (key: string, val: unknown) => {
    const str = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
    navigator.clipboard
      .writeText(str)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
      })
      .catch(() => null);
  };

  // Create Parameter Action
  const handleCreateParameter = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    const finalTool = (newTool === '__custom__' ? newCustomTool : newTool).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const finalName = newName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

    if (!finalTool || !finalName) {
      setAddError('Please enter valid tool and variable names (letters, numbers, and underscores).');
      return;
    }
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(finalTool) || !/^[a-z][a-z0-9_]{0,63}$/.test(finalName)) {
      setAddError('Identifiers must start with a lowercase letter and contain only alphanumeric characters or underscores (max 64 chars).');
      return;
    }
    if (!newDescription.trim()) {
      setAddError('Parameter description is required.');
      return;
    }

    // Taxonomy validation
    const newSubcategoryValue = newSubcategory.trim();
    if (!newCategory.trim()) {
      setAddError('Operational category is required.');
      return;
    }

    setBusy(true);
    try {
      const parsedVal = parseInputValue(newType, newDefaultValue, newDefaultBool, newDefaultNumber);

      // Parse allowed values strictly to target type
      const typedAllowedValues = newAllowedValues.map(strVal => {
        try {
          return parseTypedValue(strVal, newType);
        } catch (err: unknown) {
          throw new Error(`Allowed value "${strVal}" is not valid for type ${newType}: ${err instanceof Error ? err.message : ''}`);
        }
      });

      // Validate default value against typed allowed values
      if (typedAllowedValues.length > 0) {
        const matches = typedAllowedValues.some(item => valuesMatch(item, parsedVal));
        if (!matches) {
          throw new Error(`Default value (${displayValue(parsedVal)}) must match one of the allowed values: ${newAllowedValues.join(', ')}`);
        }
      }

      await defineParameter(finalTool, finalName, {
        value_type: newType,
        default_value: parsedVal,
        description: newDescription.trim(),
        allow_project_override: newScope === 'project',
        scope: newScope,
        category: newCategory,
        subcategory: newSubcategoryValue || null,
        allowed_values: typedAllowedValues.length > 0 ? typedAllowedValues : null,
        enabled: true,
        icon: 'sliders',
        expected_revision: 0,
      });

      setIsAddOpen(false);
      setNewName('');
      setNewDescription('');
      setNewDefaultValue('');
      setNewAllowedValues([]);
      setNewAllowedValueInput('');
      await load();
      setSelectedTool(finalTool);
      setNotice({
        type: 'success',
        message: `Created parameter ${finalTool}.${finalName} with taxonomy ${newCategory}/${newSubcategoryValue}. Persisted to runtime database.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to create parameter.';
      setAddError(msg);
    } finally {
      setBusy(false);
    }
  };

  // Delete Parameter Action (Admin)
  const handleDeleteDefinition = async (param: ParameterDefinitionRow) => {
    if (!isPlatformAdmin) return;
    const confirmed = window.confirm(
      `Delete parameter definition "${param.tool}.${param.variable_name}"?\n\nThis will remove the platform default and all project overrides from the database.`
    );
    if (!confirmed) return;

    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await deleteParameterDefinition(param.tool, param.variable_name, param.revision);
      if (activeParam && parameterKey(activeParam) === parameterKey(param)) {
        setActiveParam(null);
      }
      await load();
      setNotice({
        type: 'success',
        message: `Deleted parameter definition ${param.tool}.${param.variable_name}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to delete parameter definition.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Save Project Override Action
  const handleSaveOverride = async (targetParam?: ParameterDefinitionRow, directVal?: unknown) => {
    const item = targetParam || activeParam;
    if (!item) return;

    if (item.enabled === false || item.effective_state === 'DISABLED') {
      setError('Cannot save override on a disabled parameter.');
      return;
    }

    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      let finalValue: unknown;
      if (directVal !== undefined) {
        finalValue = directVal;
      } else {
        finalValue = parseInputValue(item.value_type, editOverrideValue, editOverrideBool, editOverrideNumber);
      }

      // Check allowed values with typed equality
      if (Array.isArray(item.allowed_values) && item.allowed_values.length > 0) {
        const matches = item.allowed_values.some(v => valuesMatch(v, finalValue));
        if (!matches) {
          throw new Error(`Value must be one of allowed values: ${item.allowed_values.map(v => displayValue(v)).join(', ')}`);
        }
      }

      await setParameterOverride(item.tool, item.variable_name, {
        value: finalValue,
        expected_revision: item.override_revision ?? 0,
        expected_definition_revision: item.revision,
      });

      await load();
      setNotice({
        type: 'success',
        message: `Saved project override for ${item.tool}.${item.variable_name}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to save project override.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Restore Default Action
  const handleResetOverride = async (targetParam?: ParameterDefinitionRow) => {
    const item = targetParam || activeParam;
    if (!item || !item.override_revision) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await resetParameterOverride(item.tool, item.variable_name, item.override_revision);
      await load();
      setNotice({
        type: 'success',
        message: `Restored default for ${item.tool}.${item.variable_name}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to reset parameter override.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Save Platform Default Action (Admin)
  const handleSavePlatformDefault = async () => {
    if (!activeParam || !isPlatformAdmin) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const finalDefault = parseInputValue(
        activeParam.value_type,
        editDefaultValue,
        editDefaultBool,
        editDefaultNumber
      );

      if (!editDescription.trim()) {
        throw new Error('Description cannot be empty.');
      }
      const editSubcategoryValue = editSubcategory.trim();
      if (!editCategory.trim()) {
        throw new Error('Operational category is required.');
      }

      // Parse allowed values strictly to activeParam.value_type
      const typedAllowedValues = editAllowedValues.map(strVal => {
        try {
          return parseTypedValue(strVal, activeParam.value_type);
        } catch (err: unknown) {
          throw new Error(`Allowed value "${strVal}" is not valid for type ${activeParam.value_type}: ${err instanceof Error ? err.message : ''}`);
        }
      });

      // Check allowed values against typed default value
      if (typedAllowedValues.length > 0) {
        const matches = typedAllowedValues.some(item => valuesMatch(item, finalDefault));
        if (!matches) {
          throw new Error(`Default value (${displayValue(finalDefault)}) must match one of the allowed values: ${editAllowedValues.join(', ')}`);
        }
      }

      const result = await defineParameter(activeParam.tool, activeParam.variable_name, {
        value_type: activeParam.value_type,
        description: editDescription.trim(),
        default_value: finalDefault,
        allow_project_override: editScope === 'project',
        scope: editScope,
        category: editCategory,
        subcategory: editSubcategoryValue || null,
        allowed_values: typedAllowedValues.length > 0 ? typedAllowedValues : null,
        enabled: editEnabled,
        icon: activeParam.icon || 'sliders',
        label: activeParam.label || null,
        section: activeParam.section || null,
        display_order: activeParam.display_order ?? null,
        is_required: activeParam.is_required || false,
        ownership: activeParam.ownership || 'runtime',
        validation_rules: activeParam.validation_rules || null,
        runtime_binding: activeParam.runtime_binding || null,
        expected_revision: activeParam.revision,
      });

      await load();
      const restartNote = result?.restart_required ? ' Note: Runtime engine changes require an API restart to take full effect.' : '';
      setNotice({
        type: 'success',
        message: `Saved platform default definition for ${activeParam.tool}.${activeParam.variable_name}.${restartNote}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to save platform default definition.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  };

  // Helper for adding an allowed value tag pill with type checking
  const handleAddAllowedValue = (
    val: string,
    targetType: ConnectorValueType,
    list: string[],
    setList: (l: string[]) => void,
    setInput: (s: string) => void,
    setErrorMsg?: (s: string | null) => void
  ) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    try {
      parseTypedValue(trimmed, targetType);
    } catch (err: unknown) {
      if (setErrorMsg) {
        setErrorMsg(err instanceof Error ? err.message : 'Invalid value for this type.');
      }
      return;
    }
    if (setErrorMsg) setErrorMsg(null);
    if (!list.includes(trimmed)) {
      setList([...list, trimmed]);
      setInput('');
    }
  };

  // Helper for removing an allowed value tag pill
  const handleRemoveAllowedValue = (
    index: number,
    list: string[],
    setList: (l: string[]) => void
  ) => {
    setList(list.filter((_, i) => i !== index));
  };

  // Active provider metadata if single provider selected
  const activeSelectedMeta = selectedTool !== 'ALL' ? getToolMeta(selectedTool, templates) : null;
  const normalizedNewSubcategory = newSubcategory.trim();
  const normalizedEditSubcategory = editSubcategory.trim();
  const newSubcategoryOptions = getSubcategories(newCategory, normalizedNewSubcategory);
  const editSubcategoryOptions = getSubcategories(editCategory, normalizedEditSubcategory);

  // Add Parameter Dialog Modal (Portaled)
  const addParameterModal = isAddOpen && createPortal(
    <div className="param-modal-overlay" onClick={() => {
      resetNewParameterForm();
      setIsAddOpen(false);
    }}>
      <div className="param-modal-card" onClick={e => e.stopPropagation()}>
        <div className="param-modal-header">
          <h3>
            <Plus size={18} color="var(--acc)" />
            Add Parameter Definition
          </h3>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 6px' }}
            onClick={() => {
              resetNewParameterForm();
              setIsAddOpen(false);
            }}
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleCreateParameter}>
          <div className="param-modal-body">
            {addError && (
              <div className="notice-banner" role="alert" style={{ borderColor: 'var(--acc-rose)', background: 'rgba(244, 63, 94, 0.08)' }}>
                <p style={{ margin: 0, color: 'var(--acc-rose)', fontSize: 12 }}>{addError}</p>
              </div>
            )}

            {/* Target Tool / Provider */}
            <div className="param-form-group">
              <label>Target Provider / Tool Family *</label>
              <select
                value={newTool}
                onChange={e => setNewTool(e.target.value)}
              >
                {uniqueTools.map(t => (
                  <option key={t} value={t}>
                    {getToolMeta(t, templates).displayName} ({t})
                  </option>
                ))}
                <option value="__custom__">+ Define New Tool or Service…</option>
              </select>
            </div>

            {newTool === '__custom__' && (
              <div className="param-form-group">
                <label>Custom Tool Identifier *</label>
                <input
                  type="text"
                  placeholder="e.g. payments, redis, llm_gateway"
                  value={newCustomTool}
                  onChange={e => setNewCustomTool(e.target.value)}
                  required
                />
                <span className="param-form-help">Lowercase letters, numbers, and underscores only.</span>
              </div>
            )}

            {/* Variable Name */}
            <div className="param-form-group">
              <label>Variable Name *</label>
              <input
                type="text"
                placeholder="e.g. max_connections, feature_enabled, timeout_seconds"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                required
              />
              <span className="param-form-help">Unique operational variable identifier.</span>
            </div>

            {/* Taxonomy: Category & Contextual Subcategory */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="param-form-group">
                <label>Operational Category *</label>
                <select
                  value={newCategory}
                  onChange={e => {
                    const cat = e.target.value;
                    setNewCategory(cat);
                    const subcats = getSubcategories(cat);
                    setNewSubcategory(subcats[0] || '');
                  }}
                >
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </option>
                  ))}
                </select>
                <span className="param-form-help">Operational discipline.</span>
              </div>

              <div className="param-form-group">
                <label>Subcategory</label>
                {newSubcategoryOptions.length > 0 ? (
                  <select
                    value={normalizedNewSubcategory}
                    onChange={e => setNewSubcategory(e.target.value)}
                  >
                    {newSubcategoryOptions.map(subcat => (
                      <option key={subcat} value={subcat}>
                        {subcat}
                      </option>
                    ))}
                    <option value="">No subcategory</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={newSubcategory}
                    onChange={e => setNewSubcategory(e.target.value)}
                    placeholder="Type a descriptive subcategory"
                  />
                )}
                <span className="param-form-help">Configuration facet.</span>
              </div>
            </div>

            {/* Value Type */}
            <div className="param-form-group">
              <label>Value Type *</label>
              <select
                value={newType}
                onChange={e => {
                  const type = e.target.value as ConnectorValueType;
                  setNewType(type);
                  setNewAllowedValues([]);
                  setNewAllowedValueInput('');
                  setNewTypeDefaults(type);
                }}
              >
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="number">Number (Float)</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON Object / Array</option>
                <option value="secret_ref">Secret Reference (env://VAR)</option>
              </select>
            </div>

            {/* Allowed Values (Optional constrained values) */}
            <div className="param-form-group">
              <label>Allowed Values (Constrained Inputs)</label>
              <div className="param-tag-container">
                {newAllowedValues.map((val, idx) => (
                  <span key={idx} className="param-tag-pill">
                    {val}
                    <button
                      type="button"
                      className="param-tag-remove"
                      onClick={() => handleRemoveAllowedValue(idx, newAllowedValues, setNewAllowedValues)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder={newAllowedValues.length === 0 ? `Type ${newType} value and press Enter…` : 'Add more…'}
                  className="param-tag-input"
                  value={newAllowedValueInput}
                  onChange={e => setNewAllowedValueInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddAllowedValue(
                        newAllowedValueInput,
                        newType,
                        newAllowedValues,
                        setNewAllowedValues,
                        setNewAllowedValueInput,
                        setAddError
                      );
                    }
                  }}
                />
              </div>
              <span className="param-form-help">
                Validated strictly against {newType} syntax. Projects can only choose among these values.
              </span>
            </div>

            {/* Default Value Input based on Type */}
            <div className="param-form-group">
              <label>Default Value *</label>
              {newType === 'boolean' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className={`btn ${newDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNewDefaultBool(true)}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <CheckCircle2 size={13} /> TRUE
                  </button>
                  <button
                    type="button"
                    className={`btn ${!newDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setNewDefaultBool(false)}
                    style={{ flex: 1, padding: 8 }}
                  >
                    <X size={13} /> FALSE
                  </button>
                </div>
              )}

              {(newType === 'integer' || newType === 'number') && (
                <input
                  type="number"
                  step={newType === 'integer' ? '1' : 'any'}
                  value={Number.isFinite(newDefaultNumber) ? newDefaultNumber : ''}
                  onChange={e => setNewDefaultNumber(e.target.valueAsNumber)}
                  required
                />
              )}

              {newType === 'secret_ref' && (
                <input
                  type="text"
                  placeholder="env://SERVICE_TOKEN"
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}

              {newType === 'json' && (
                <textarea
                  rows={3}
                  placeholder='{"key": "value"}'
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}

              {newType === 'string' && (
                <input
                  type="text"
                  placeholder="Default string value"
                  value={newDefaultValue}
                  onChange={e => setNewDefaultValue(e.target.value)}
                  required
                />
              )}
            </div>

            {/* Description */}
            <div className="param-form-group">
              <label>Description *</label>
              <textarea
                rows={2}
                placeholder="What this parameter controls in the runtime environment..."
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                required
              />
            </div>

            <div className="param-form-group">
              <label>Parameter Scope *</label>
              <select value={newScope} onChange={e => setNewScope(e.target.value as ParameterScope)}>
                <option value="project">Project Workspace (Overrides permitted)</option>
                <option value="platform">Platform Policy Baseline (Global baseline)</option>
                <option value="platform_only">Platform Only (Locked policy)</option>
              </select>
              <span className="param-form-help">Scope maps strictly to the persisted platform default and project override policy.</span>
            </div>
          </div>

          <div className="param-modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                resetNewParameterForm();
                setIsAddOpen(false);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
            >
              <Save size={13} />
              {busy ? 'Creating…' : 'Save Parameter Definition'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );

  // Drawer JSX (Mounted to document.body via createPortal)
  const drawerPortal = activeParam && createPortal(
    <div className="param-drawer-backdrop" onClick={() => setActiveParam(null)}>
      <div className="param-drawer" onClick={e => e.stopPropagation()}>
        {/* Drawer Header */}
        <div className="param-drawer-header">
          <div>
            <div className="param-taxonomy-crumb-row">
              <span className="param-crumb-main">{activeParam.main || activeParam.tool}</span>
              <span className="param-crumb-sep">/</span>
              <span className="param-crumb-cat">{activeParam.category || 'operational'}</span>
              {activeParam.subcategory && (
                <>
                  <span className="param-crumb-sep">/</span>
                  <span className="param-crumb-subcat">{activeParam.subcategory}</span>
                </>
              )}
            </div>
            <div className="param-drawer-title-row">
              <span className="param-tool-avatar" style={{ width: 28, height: 28 }}>
                {getToolMeta(activeParam.tool, templates).icon}
              </span>
              <h3 className="param-drawer-param-name">{parameterKey(activeParam)}</h3>
            </div>
            <div className="param-drawer-badges">
              <span className={`param-type-badge ${activeParam.value_type}`}>
                {formatValueType(activeParam.value_type)}
              </span>
              <span className="param-pill-badge default">Def Rev {activeParam.revision}</span>
              {Boolean(activeParam.override_revision) && (
                <span className="param-pill-badge overridden">
                  Override Rev {activeParam.override_revision}
                </span>
              )}
              {activeParam.enabled === false && (
                <span className="param-pill-badge disabled">Disabled</span>
              )}
            </div>
          </div>
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 8px' }}
            onClick={() => setActiveParam(null)}
            title="Close inspector (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="param-drawer-tabs-bar">
          <button
            className={`param-tab-btn ${drawerTab === 'override' ? 'active' : ''}`}
            onClick={() => setDrawerTab('override')}
          >
            <Sparkles size={14} /> Project Override
          </button>
          {isPlatformAdmin && (
            <button
              className={`param-tab-btn ${drawerTab === 'platform_default' ? 'active' : ''}`}
              onClick={() => setDrawerTab('platform_default')}
            >
              <Shield size={14} /> Platform Default
            </button>
          )}
          <button
            className={`param-tab-btn ${drawerTab === 'details' ? 'active' : ''}`}
            onClick={() => setDrawerTab('details')}
          >
            <Info size={14} /> Details & Lineage
          </button>
        </div>

        {/* Drawer Content */}
        <div className="param-drawer-body">
          {/* Tab 1: Project Override */}
          {drawerTab === 'override' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
                {activeParam.description}
              </p>

              {activeParam.enabled === false || activeParam.effective_state === 'DISABLED' ? (
                <div className="notice-banner" style={{ borderColor: 'var(--acc-rose)', background: 'rgba(244, 63, 94, 0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--acc-rose)', fontWeight: 600 }}>
                    <Lock size={16} />
                    <strong>Disabled by Platform Policy</strong>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                    This parameter is currently disabled by deployment governance and cannot receive project overrides.
                  </p>
                </div>
              ) : !activeParam.allow_project_override ? (
                <div className="notice-banner" style={{ borderColor: 'rgba(148, 163, 184, 0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8' }}>
                    <Lock size={16} />
                    <strong>Platform Policy Enforced</strong>
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                    Project overrides are disabled for this parameter by platform governance. Platform administrators can enable overrides in the Platform Default tab.
                  </p>
                </div>
              ) : !canOverride ? (
                <div className="notice-banner">
                  <p style={{ margin: 0, fontSize: 12 }}>
                    Saving project overrides requires the <code>PLATFORM_ADMIN</code> or <code>PROJECT_OWNER</code> role.
                  </p>
                </div>
              ) : (
                <>
                  {/* Interactive Value Inputs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                      Project Value Override · {formatValueType(activeParam.value_type)}
                    </label>

                    {/* Constrained Dropdown if scalar allowed_values exist */}
                    {areAllowedValuesScalar(activeParam.allowed_values) ? (
                      <div>
                        <select
                          value={editOverrideValue}
                          onChange={e => {
                            const selected = e.target.value;
                            setEditOverrideValue(selected);
                            if (activeParam.value_type === 'boolean') {
                              setEditOverrideBool(selected.toLowerCase() === 'true');
                            }
                            if (activeParam.value_type === 'integer' || activeParam.value_type === 'number') {
                              setEditOverrideNumber(Number(selected));
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: 10,
                            background: 'var(--card-subtle)',
                            border: '1px solid var(--line)',
                            borderRadius: 8,
                            color: 'var(--tx)',
                          }}
                        >
                          {activeParam.allowed_values!.map((opt, i) => {
                            const str = typeof opt === 'string' ? opt : JSON.stringify(opt);
                            return (
                              <option key={i} value={str}>
                                {str}
                              </option>
                            );
                          })}
                        </select>
                        <p className="metric-meta" style={{ marginTop: 4 }}>
                          Constrained strictly to platform-approved values.
                        </p>
                      </div>
                    ) : activeParam.value_type === 'boolean' ? (
                      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                        <button
                          type="button"
                          className={`btn ${editOverrideBool ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setEditOverrideBool(true)}
                          style={{ flex: 1, padding: 10 }}
                        >
                          <CheckCircle2 size={14} /> TRUE (Enabled)
                        </button>
                        <button
                          type="button"
                          className={`btn ${!editOverrideBool ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => setEditOverrideBool(false)}
                          style={{ flex: 1, padding: 10 }}
                        >
                          <X size={14} /> FALSE (Disabled)
                        </button>
                      </div>
                    ) : (activeParam.value_type === 'integer' || activeParam.value_type === 'number') ? (
                      <input
                        type="number"
                        step={activeParam.value_type === 'integer' ? '1' : 'any'}
                        value={Number.isFinite(editOverrideNumber) ? editOverrideNumber : ''}
                        onChange={e => {
                          setEditOverrideNumber(e.target.valueAsNumber);
                          setEditOverrideValue(e.target.value);
                        }}
                        style={{
                          padding: 10,
                          background: 'var(--card-subtle)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--tx)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      />
                    ) : activeParam.value_type === 'secret_ref' ? (
                      <div>
                        <input
                          type="text"
                          value={editOverrideValue}
                          onChange={e => setEditOverrideValue(e.target.value)}
                          placeholder="env://SERVICE_CREDENTIAL"
                          style={{
                            width: '100%',
                            padding: 10,
                            background: 'var(--card-subtle)',
                            border: '1px solid var(--line)',
                            borderRadius: 8,
                            color: 'var(--tx)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        />
                        <p className="metric-meta" style={{ marginTop: 4 }}>
                          Enter an <code>env://VARIABLE_NAME</code> reference. Raw credentials are rejected.
                        </p>
                      </div>
                    ) : activeParam.value_type === 'json' ? (
                      <div>
                        <textarea
                          rows={7}
                          value={editOverrideValue}
                          onChange={e => {
                            setEditOverrideValue(e.target.value);
                            try {
                              JSON.parse(e.target.value);
                              setOverrideJsonError(null);
                            } catch (err: any) {
                              setOverrideJsonError(err.message);
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: 10,
                            background: 'rgba(0, 0, 0, 0.25)',
                            border: overrideJsonError ? '1px solid var(--acc-rose)' : '1px solid var(--line)',
                            borderRadius: 8,
                            color: 'var(--tx)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                          }}
                        />
                        {overrideJsonError && (
                          <span style={{ color: 'var(--acc-rose)', fontSize: 11, marginTop: 4, display: 'block' }}>
                            JSON Syntax Error: {overrideJsonError}
                          </span>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ marginTop: 6, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => {
                            try {
                              const formatted = JSON.stringify(JSON.parse(editOverrideValue), null, 2);
                              setEditOverrideValue(formatted);
                              setOverrideJsonError(null);
                            } catch {
                              setOverrideJsonError('Cannot format invalid JSON');
                            }
                          }}
                        >
                          <Code size={12} /> Format JSON
                        </button>
                      </div>
                    ) : (
                      <textarea
                        rows={4}
                        value={editOverrideValue}
                        onChange={e => setEditOverrideValue(e.target.value)}
                        style={{
                          width: '100%',
                          padding: 10,
                          background: 'var(--card-subtle)',
                          border: '1px solid var(--line)',
                          borderRadius: 8,
                          color: 'var(--tx)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                        }}
                      />
                    )}
                  </div>

                  {/* Side-by-side Diff Table */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>
                      Value Comparison & Effective State
                    </span>
                    <table className="param-diff-table">
                      <tbody>
                        <tr>
                          <th style={{ width: '35%' }}>Platform Default</th>
                          <td>{displayValue(activeParam.default_value)}</td>
                        </tr>
                        <tr>
                          <th>Current Effective</th>
                          <td style={{ color: activeParam.override_revision ? '#22c55e' : 'var(--tx)', fontWeight: 600 }}>
                            {displayValue(activeParam.effective_value)}
                          </td>
                        </tr>
                        <tr>
                          <th>Effective State</th>
                          <td>
                            {activeParam.effective_state === 'INHERIT'
                              ? 'Inheriting platform default'
                              : activeParam.effective_state === 'SET'
                              ? 'Project override active'
                              : 'Disabled by policy'}
                          </td>
                        </tr>
                        <tr>
                          <th>Source & Revision</th>
                          <td>
                            {activeParam.source.toUpperCase()} · rev {activeParam.override_revision || activeParam.revision}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button
                      className="btn btn-primary"
                      disabled={busy || Boolean(overrideJsonError)}
                      onClick={() => handleSaveOverride()}
                      style={{ flex: 1 }}
                    >
                      <Save size={14} className={busy ? 'spin' : ''} />
                      {busy ? 'Saving…' : 'Save Project Override'}
                    </button>
                    {Boolean(activeParam.override_revision) && (
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => handleResetOverride()}
                        title="Revert override to deployment platform default"
                      >
                        <RotateCcw size={14} /> Restore Default
                      </button>
                    )}
                  </div>

                  <p className="metric-meta" style={{ marginTop: 4 }}>
                    Note: Runtime engine constraints and connector endpoints take effect on the next API server restart.
                  </p>
                </>
              )}
            </div>
          )}

          {/* Tab 2: Platform Default (Admin) */}
          {drawerTab === 'platform_default' && isPlatformAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="notice-banner" style={{ background: 'rgba(56, 189, 248, 0.05)', borderColor: 'rgba(56, 189, 248, 0.2)' }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--tx)' }}>
                  Platform administrators can manage baseline defaults, operational taxonomy, allowed value constraints, and project override permissions.
                </p>
              </div>

              {/* Taxonomy Controls: Category & Subcategory */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                    Operational Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={e => {
                      const cat = e.target.value;
                      setEditCategory(cat);
                      const subcats = getSubcategories(cat);
                      setEditSubcategory(subcats[0] || '');
                    }}
                    style={{
                      padding: 8,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      color: 'var(--tx)',
                    }}
                  >
                    {availableCategories.map(cat => (
                      <option key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                    Subcategory Facet
                  </label>
                  {editSubcategoryOptions.length > 0 ? (
                    <select
                      value={normalizedEditSubcategory}
                      onChange={e => setEditSubcategory(e.target.value)}
                      style={{
                        padding: 8,
                        background: 'var(--card-subtle)',
                        border: '1px solid var(--line)',
                        borderRadius: 6,
                        color: 'var(--tx)',
                      }}
                    >
                      {editSubcategoryOptions.map(subcat => (
                        <option key={subcat} value={subcat}>
                          {subcat}
                        </option>
                      ))}
                      <option value="">No subcategory</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={editSubcategory}
                      onChange={e => setEditSubcategory(e.target.value)}
                      style={{
                        padding: 8,
                        background: 'var(--card-subtle)',
                        border: '1px solid var(--line)',
                        borderRadius: 6,
                        color: 'var(--tx)',
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Description Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                  Parameter Description
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  maxLength={2000}
                  style={{
                    padding: 10,
                    background: 'var(--card-subtle)',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    color: 'var(--tx)',
                    fontSize: 12,
                  }}
                />
              </div>

              {/* Allowed Values Tag Editor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                  Allowed Value Constraints ({activeParam.value_type})
                </label>
                <div className="param-tag-container">
                  {editAllowedValues.map((val, idx) => (
                    <span key={idx} className="param-tag-pill">
                      {val}
                      <button
                        type="button"
                        className="param-tag-remove"
                        onClick={() => handleRemoveAllowedValue(idx, editAllowedValues, setEditAllowedValues)}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    placeholder={`Type ${activeParam.value_type} and press Enter…`}
                    className="param-tag-input"
                    value={editAllowedValueInput}
                    onChange={e => setEditAllowedValueInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddAllowedValue(
                          editAllowedValueInput,
                          activeParam.value_type,
                          editAllowedValues,
                          setEditAllowedValues,
                          setEditAllowedValueInput,
                          setDefaultJsonError
                        );
                      }
                    }}
                  />
                </div>
              </div>

              {/* Platform Default Value */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx)' }}>
                  Default Value · {formatValueType(activeParam.value_type)}
                </label>

                {activeParam.value_type === 'boolean' && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className={`btn ${editDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setEditDefaultBool(true)}
                      style={{ flex: 1, padding: 8 }}
                    >
                      <CheckCircle2 size={14} /> TRUE
                    </button>
                    <button
                      type="button"
                      className={`btn ${!editDefaultBool ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setEditDefaultBool(false)}
                      style={{ flex: 1, padding: 8 }}
                    >
                      <X size={14} /> FALSE
                    </button>
                  </div>
                )}

                {(activeParam.value_type === 'integer' || activeParam.value_type === 'number') && (
                  <input
                    type="number"
                    step={activeParam.value_type === 'integer' ? '1' : 'any'}
                    value={Number.isFinite(editDefaultNumber) ? editDefaultNumber : ''}
                    onChange={e => {
                      setEditDefaultNumber(e.target.valueAsNumber);
                      setEditDefaultValue(e.target.value);
                    }}
                    style={{
                      padding: 10,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                )}

                {activeParam.value_type === 'secret_ref' && (
                  <input
                    type="text"
                    value={editDefaultValue}
                    onChange={e => setEditDefaultValue(e.target.value)}
                    placeholder="env://SECRET_KEY"
                    style={{
                      padding: 10,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                )}

                {activeParam.value_type === 'json' && (
                  <div>
                    <textarea
                      rows={5}
                      value={editDefaultValue}
                      onChange={e => {
                        setEditDefaultValue(e.target.value);
                        try {
                          JSON.parse(e.target.value);
                          setDefaultJsonError(null);
                        } catch (err: any) {
                          setDefaultJsonError(err.message);
                        }
                      }}
                      style={{
                        padding: 10,
                        background: 'rgba(0, 0, 0, 0.25)',
                        border: defaultJsonError ? '1px solid var(--acc-rose)' : '1px solid var(--line)',
                        borderRadius: 8,
                        color: 'var(--tx)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        width: '100%',
                      }}
                    />
                    {defaultJsonError && (
                      <span style={{ color: 'var(--acc-rose)', fontSize: 11, marginTop: 4, display: 'block' }}>
                        JSON Syntax Error: {defaultJsonError}
                      </span>
                    )}
                  </div>
                )}

                {activeParam.value_type === 'string' && (
                  <textarea
                    rows={3}
                    value={editDefaultValue}
                    onChange={e => setEditDefaultValue(e.target.value)}
                    style={{
                      padding: 10,
                      background: 'var(--card-subtle)',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      color: 'var(--tx)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  />
                )}
              </div>

              {/* Scope and Governance Controls */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--tx)' }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Parameter Scope</span>
                  <select
                    value={editScope}
                    onChange={e => {
                      const value = e.target.value as ParameterScope;
                      setEditScope(value);
                      setEditAllowOverride(value === 'project');
                    }}
                  style={{ padding: 8, background: 'var(--card-subtle)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--tx)' }}
                >
                  <option value="project">Project Workspace Override Permitted</option>
                  <option value="platform">Platform Policy Baseline (Global baseline)</option>
                  <option value="platform_only">Platform Only (Locked)</option>
                </select>
              </label>

              {/* Enabled Switch */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={e => setEditEnabled(e.target.checked)}
                />
                <span style={{ fontSize: 13, color: 'var(--tx)', fontWeight: 500 }}>
                  Enable parameter in runtime environment
                </span>
              </label>

              {/* Allow Project Override Checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={editAllowOverride}
                  onChange={e => {
                    setEditAllowOverride(e.target.checked);
                    setEditScope(e.target.checked ? 'project' : 'platform_only');
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--tx)' }}>
                  Allow project workspaces to override this parameter
                </span>
              </label>

              {/* Save Platform Default Button */}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || !editDescription.trim() || Boolean(defaultJsonError)}
                  onClick={() => handleSavePlatformDefault()}
                  style={{ flex: 1 }}
                >
                  <Save size={14} className={busy ? 'spin' : ''} />
                  {busy ? 'Saving…' : 'Save Platform Definition'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => handleDeleteDefinition(activeParam)}
                  style={{ color: 'var(--acc-rose)' }}
                  title="Delete parameter definition from database"
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Details & Lineage */}
          {drawerTab === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <table className="param-diff-table">
                <tbody>
                  <tr>
                    <th style={{ width: '40%' }}>Main System Family</th>
                    <td>{activeParam.main || activeParam.tool}</td>
                  </tr>
                  <tr>
                    <th>Operational Category</th>
                    <td>{activeParam.category || 'operational'}</td>
                  </tr>
                  <tr>
                    <th>Subcategory Facet</th>
                    <td>{activeParam.subcategory || 'None'}</td>
                  </tr>
                  <tr>
                    <th>Variable Identifier</th>
                    <td>{activeParam.variable_name}</td>
                  </tr>
                  <tr>
                    <th>Type Specification</th>
                    <td>{activeParam.value_type}</td>
                  </tr>
                  <tr>
                    <th>Effective State</th>
                    <td>
                      {activeParam.effective_state || (activeParam.enabled === false ? 'DISABLED' : 'SET')}
                    </td>
                  </tr>
                  <tr>
                    <th>Definition Revision</th>
                    <td>{activeParam.revision}</td>
                  </tr>
                  <tr>
                    <th>Override Revision</th>
                    <td>{activeParam.override_revision ?? 'None (Platform Baseline)'}</td>
                  </tr>
                  <tr>
                    <th>Project Override Allowed</th>
                    <td style={{ color: activeParam.allow_project_override ? 'var(--acc)' : 'var(--muted)' }}>
                      {activeParam.allow_project_override ? 'Yes (Permitted)' : 'No (Locked by Platform)'}
                    </td>
                  </tr>
                  <tr>
                    <th>Current Value Source</th>
                    <td>{activeParam.source.toUpperCase()}</td>
                  </tr>
                </tbody>
              </table>

              <div className="notice-banner" style={{ fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
                  <Clock size={14} /> Persistence & Lineage Contract
                </div>
                <p style={{ margin: 0, color: 'var(--muted)', lineHeight: 1.5 }}>
                  Saved parameter definitions and project overrides are persisted to the PostgreSQL database with row-level revision locks. All updates are logged in the immutable audit lineage.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );

  // Render Table Row
  const sharedGovernance = (param: ParameterDefinitionRow) => {
    const template = templates.find(item => item.system_name === param.tool);
    if (!template?.parameter_fields?.some(field => field.variable_name === param.variable_name)) return null;
    const field = template.field_governance?.find(item => item.variable_name === param.variable_name);
    return field ? { template, field } : null;
  };

  const changeGovernance = async (param: ParameterDefinitionRow, tier: GovernanceTier) => {
    const shared = sharedGovernance(param);
    if (!isPlatformAdmin || !shared || savingGovernance) return;
    if (shared.field.tier === 'project_editable' && tier !== 'project_editable' &&
        !window.confirm('Removing project edit access clears existing project overrides for this field. Continue?')) return;
    setSavingGovernance(parameterKey(param));
    setError(null);
    try {
      await saveConnectorFieldGovernance(shared.template.system_name, shared.template.governance_revision || 0, { [param.variable_name]: tier });
      if (!await load()) return;
      setNotice({ type: 'success', message: `Field access saved for ${param.label || param.variable_name}. Connector forms and parameter values now use the updated policy.` });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Field access could not be saved. Reload and try again.');
    } finally {
      setSavingGovernance(null);
    }
  };

  const renderScopeControl = (param: ParameterDefinitionRow) => {
    const shared = sharedGovernance(param);
    if (!shared) return <span className="param-scope-label">{param.scope}</span>;
    if (!isPlatformAdmin) return <span className="param-scope-label">{shared.field.tier.replaceAll('_', ' ')}</span>;
    return <select
      className="param-governance-select"
      aria-label={`${param.label || param.variable_name} field access`}
      value={shared.field.tier}
      disabled={Boolean(savingGovernance)}
      onChange={event => void changeGovernance(param, event.target.value as GovernanceTier)}
    >
      <option value="platform_only">Platform Only</option>
      <option value="project_locked">Project Non-Editable</option>
      <option value="project_editable" disabled={!shared.field.editable_allowed}>Project Editable</option>
    </select>;
  };

  const renderTableRow = (param: ParameterDefinitionRow) => {
    const isOverridden = Boolean(param.override_revision && param.override_revision > 0);
    const key = parameterKey(param);
    const isCopied = copiedKey === key;
    const isRowDisabled = param.enabled === false || param.effective_state === 'DISABLED';
    const stateClass = isRowDisabled
      ? 'is-state-disabled'
      : isOverridden
      ? 'is-state-set'
      : 'is-state-inherit';

    return (
      <tr key={key} className={`${isOverridden ? 'is-overridden' : ''} ${stateClass}`}>
        {/* Name & Taxonomy Breadcrumb */}
        <td>
          <div className="param-cell-name">
            <div className="param-taxonomy-crumb-row">
              <span className="param-crumb-main">{param.main || param.tool}</span>
              <span className="param-crumb-sep">/</span>
              <span className="param-crumb-cat">{param.category || 'operational'}</span>
              {param.subcategory && (
                <>
                  <span className="param-crumb-sep">/</span>
                  <span className="param-crumb-subcat">{param.subcategory}</span>
                </>
              )}
            </div>
            <span className="param-key-text">{param.label || param.variable_name}</span>
            <span className="param-desc-subtext" title={param.description}>
              {param.description}
            </span>
            {param.allowed_values && param.allowed_values.length > 0 && (
              <span className="param-allowed-preview">
                Allowed: {param.allowed_values.map(v => displayValue(v)).join(', ')}
              </span>
            )}
          </div>
        </td>

        {/* Type Badge */}
        <td>
          <span className={`param-type-badge ${param.value_type}`}>
            {formatValueType(param.value_type)}
          </span>
        </td>

        {/* Effective Value & Inline Toggle */}
        <td>
          <div className="param-cell-value">
            {param.value_type === 'boolean' && param.allow_project_override && canOverride && !isRowDisabled ? (
              <button
                type="button"
                className={`param-inline-toggle ${param.effective_value ? 'is-true' : 'is-false'}`}
                disabled={busy}
                onClick={() => handleSaveOverride(param, !param.effective_value)}
                title={`Click to quickly toggle to ${!param.effective_value}`}
              >
                {param.effective_value ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                <span>{param.effective_value ? 'TRUE' : 'FALSE'}</span>
              </button>
            ) : param.value_type === 'secret_ref' ? (
              <span className="param-value-code" style={{ color: 'var(--acc-amber)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Key size={11} /> {String(param.effective_value)}
              </span>
            ) : param.value_type === 'boolean' ? (
              <span
                style={{
                  color: param.effective_value ? '#22c55e' : 'var(--muted)',
                  fontWeight: 700,
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {param.effective_value ? 'TRUE' : 'FALSE'}
              </span>
            ) : (
              <span className={`param-value-code ${isOverridden ? 'is-override' : ''}`}>
                {displayValue(param.effective_value)}
              </span>
            )}

            {/* Quick Copy Button */}
            <button
              className="param-copy-btn"
              onClick={() => handleCopyValue(key, param.effective_value)}
              title={isCopied ? 'Copied!' : 'Copy value'}
            >
              {isCopied ? <Check size={13} color="#22c55e" /> : <Copy size={13} />}
            </button>
          </div>
        </td>

        {/* Status / Governance */}
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            {isRowDisabled ? (
              <span className="param-pill-badge disabled" title="Disabled by policy">
                <Lock size={10} /> Disabled
              </span>
            ) : isOverridden ? (
              <span className="param-pill-badge overridden" title={`Custom project override (rev ${param.override_revision})`}>
                <Sparkles size={11} /> Override (r{param.override_revision})
              </span>
            ) : param.effective_state !== 'INHERIT' ? (
              <span className="param-pill-badge default" title="Platform baseline setting">
                Platform Default
              </span>
            ) : null}
            {renderScopeControl(param)}
          </div>
        </td>

        {/* Row Actions */}
        <td>
          <div className="param-row-actions">
            <button
              className="param-action-btn"
              onClick={() => {
                setActiveParam(param);
                setNotice(null);
              }}
              title="Configure parameter and inspect lineage"
            >
              <Sliders size={12} /> Configure
            </button>

            {isOverridden && canOverride && (
              <button
                className="param-action-btn revert"
                disabled={busy}
                onClick={() => handleResetOverride(param)}
                title="Restore platform default value"
              >
                <RotateCcw size={12} />
              </button>
            )}

            {isPlatformAdmin && (
              <button
                className="param-action-btn delete"
                disabled={busy}
                onClick={() => handleDeleteDefinition(param)}
                title="Delete parameter definition from database"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Render Card View
  const renderCard = (param: ParameterDefinitionRow) => {
    const isOverridden = Boolean(param.override_revision && param.override_revision > 0);
    const key = parameterKey(param);
    const isCopied = copiedKey === key;
    const isRowDisabled = param.enabled === false || param.effective_state === 'DISABLED';
    const stateClass = isRowDisabled
      ? 'is-state-disabled'
      : isOverridden
      ? 'is-state-set'
      : 'is-state-inherit';

    return (
      <div key={key} className={`param-card ${isOverridden ? 'is-overridden' : ''} ${stateClass}`}>
        <div>
          {/* Card Top: Taxonomy & Badges */}
          <div className="param-card-header">
            <div className="param-name-wrapper">
              <div className="param-taxonomy-crumb-row">
                <span className="param-crumb-main">{param.main || param.tool}</span>
                <span className="param-crumb-sep">/</span>
                <span className="param-crumb-cat">{param.category || 'operational'}</span>
                {param.subcategory && (
                  <>
                    <span className="param-crumb-sep">/</span>
                    <span className="param-crumb-subcat">{param.subcategory}</span>
                  </>
                )}
              </div>
              <span className="param-name">{param.label || param.variable_name}</span>
            </div>
            <div className="param-card-badges">
              <span className={`param-type-badge ${param.value_type}`}>
                {formatValueType(param.value_type)}
              </span>
              {isRowDisabled ? (
                <span className="param-pill-badge disabled">
                  <Lock size={10} /> Disabled
                </span>
              ) : isOverridden ? (
                <span className="param-pill-badge overridden" title="Custom Project Override">
                  <Sparkles size={10} /> Override (r{param.override_revision})
                </span>
              ) : param.effective_state !== 'INHERIT' ? (
                <span className="param-pill-badge default" title="Platform baseline">
                  Platform Default
                </span>
              ) : null}
              {renderScopeControl(param)}
            </div>
          </div>

          {/* Description */}
          <p className="param-desc" title={param.description}>
            {param.description}
          </p>

          {/* Value Display Box */}
          <div className="param-value-box">
            <div className="param-value-header">
              <span>{isOverridden ? 'Project Effective Value' : 'Effective Default'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)' }}>rev {param.revision}</span>
                <button
                  className="param-copy-btn"
                  onClick={() => handleCopyValue(key, param.effective_value)}
                  title={isCopied ? 'Copied!' : 'Copy value'}
                >
                  {isCopied ? <Check size={11} color="#22c55e" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
            <div className="param-value-display">
              {param.value_type === 'secret_ref' ? (
                <span style={{ color: 'var(--acc-amber)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Key size={12} /> {String(param.effective_value)}
                </span>
              ) : param.value_type === 'boolean' ? (
                <span style={{ color: param.effective_value ? '#22c55e' : 'var(--muted)', fontWeight: 700 }}>
                  {param.effective_value ? 'TRUE' : 'FALSE'}
                </span>
              ) : (
                displayValue(param.effective_value)
              )}
            </div>
            {isOverridden && (
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
                Default: <code>{displayValue(param.default_value)}</code>
              </div>
            )}
            {param.allowed_values && param.allowed_values.length > 0 && (
              <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: 3 }}>
                Allowed: {param.allowed_values.map(v => displayValue(v)).join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Card Footer Actions */}
        <div className="param-card-actions">
          <button
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '5px 10px' }}
            onClick={() => {
              setActiveParam(param);
              setNotice(null);
            }}
          >
            <Sliders size={12} /> Configure
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {param.value_type === 'boolean' && param.allow_project_override && canOverride && !isRowDisabled && (
              <button
                className="btn btn-secondary"
                style={{
                  fontSize: '11px',
                  padding: '5px 10px',
                  color: param.effective_value ? '#22c55e' : 'var(--muted)',
                }}
                disabled={busy}
                onClick={() => handleSaveOverride(param, !param.effective_value)}
                title={`Toggle override to ${!param.effective_value}`}
              >
                {param.effective_value ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                {param.effective_value ? 'On' : 'Off'}
              </button>
            )}

            {isOverridden && canOverride && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 8px' }}
                disabled={busy}
                onClick={() => handleResetOverride(param)}
                title="Revert to Platform Default"
              >
                <RotateCcw size={12} />
              </button>
            )}

            {isPlatformAdmin && (
              <button
                className="btn btn-secondary"
                style={{ fontSize: '11px', padding: '5px 8px', color: 'var(--acc-rose)' }}
                disabled={busy}
                onClick={() => handleDeleteDefinition(param)}
                title="Delete parameter definition from database"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="view-container param-studio-page">
      {/* Standard Hero Banner */}
      <section className="hero-banner">
        <div className="hero-main">
          <h1 className="hero-title">
            Parameter Studio & <span>Runtime Tuning</span>
          </h1>
          <p className="hero-lede">
            Declarative operational variables, stage-level tuning, and dual-custody parameter overrides for active connectors.
          </p>
          <div className="hero-meta-strip">
            <span className="hero-stat-chip">
              <Sliders size={12} /> <b>{loading ? '…' : stats.total}</b> Parameters
            </span>
            <span className="hero-stat-chip">
              <span className="dot pulse" /> <b>{stats.overridden}</b> Overrides
            </span>
            <span className="hero-stat-chip">
              <Lock size={11} /> <b>{stats.platformEnforced}</b> Enforced
            </span>
          </div>
        </div>

        <div className="hero-actions">
          <div className="hero-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowTaxonomyGuide(!showTaxonomyGuide)}
              title="Toggle taxonomy and governance reference guide"
            >
              <HelpCircle size={13} /> {showTaxonomyGuide ? 'Hide Guide' : 'Taxonomy Guide'}
            </button>

            {canOverride && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  resetNewParameterForm(selectedTool !== 'ALL' ? { tool: selectedTool } : undefined);
                  setIsAddOpen(true);
                }}
                title="Define and persist a new parameter set"
              >
                <Plus size={13} /> Add Parameter
              </button>
            )}

            <div className="param-view-toggle">
              <button
                type="button"
                className={`param-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Switch to high-density table view"
              >
                <List size={13} /> Table
              </button>
              <button
                type="button"
                className={`param-view-btn ${viewMode === 'cards' ? 'active' : ''}`}
                onClick={() => setViewMode('cards')}
                title="Switch to card grid view"
              >
                <Grid size={13} /> Cards
              </button>
            </div>

            <button
              className="btn btn-secondary"
              disabled={loading || busy}
              onClick={() => void load()}
              title="Reload all parameters from the server"
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Collapsible Taxonomy Guidance Reference Panel */}
      {showTaxonomyGuide && (
        <section className="param-taxonomy-guide">
          <div className="param-taxonomy-guide-header" onClick={() => setShowTaxonomyGuide(false)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag size={15} color="var(--acc)" />
              <strong style={{ fontSize: 13 }}>Parameter Taxonomy & Governance Reference</strong>
            </div>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Click to collapse</span>
          </div>
          <div className="param-taxonomy-guide-grid">
            <div className="param-taxonomy-guide-card">
              <h4>
                <Boxes size={13} color="var(--acc)" /> 1. Main (System Family)
              </h4>
              <p>
                Identifies the core service or tool connector domain (e.g., <code>runtime</code>, <code>jira</code>, <code>splunk</code>).
              </p>
            </div>
            <div className="param-taxonomy-guide-card">
              <h4>
                <Layers size={13} color="#22c55e" /> 2. Category (Operational Discipline)
              </h4>
              <p>
                Broad engineering boundary: <code>connectivity</code>, <code>identity</code>, <code>performance</code>, <code>runtime</code>, <code>schedules</code>, <code>security</code>.
              </p>
            </div>
            <div className="param-taxonomy-guide-card">
              <h4>
                <Filter size={13} color="#c084fc" /> 3. Subcategory (Configuration Facet)
              </h4>
              <p>
                Targeted operational facet: <code>endpoint</code>, <code>authentication</code>, <code>timeouts</code>, <code>retry</code>, <code>rate_limit</code>.
              </p>
            </div>
            <div className="param-taxonomy-guide-card">
              <h4>
                <Shield size={13} color="#f59e0b" /> 4. Effective State & Scopes
              </h4>
              <p>
                <code>SET</code> (active override), <code>INHERIT</code> (inherited baseline), or <code>DISABLED</code> (locked by governance).
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Parameter Lifecycle Stepper */}
      <div className="param-lifecycle-strip">
        <div className="param-lifecycle-steps">
          <div className="param-lifecycle-step active">
            <Sparkles size={12} />
            <span>1. Draft (Create & Edit)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <CheckCircle2 size={12} />
            <span>2. Validate (Schema & Security)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Shield size={12} />
            <span>3. Review (Revision Guard)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Database size={12} />
            <span>4. Publish (PostgreSQL)</span>
          </div>
          <span className="param-lifecycle-arrow">→</span>
          <div className="param-lifecycle-step completed">
            <Cpu size={12} />
            <span>5. Runtime (ADK Bound)</span>
          </div>
        </div>
        <div className="param-lifecycle-meta">
          <span>{stats.overridden} active overrides · Cryptographic revision locks</span>
        </div>
      </div>

      {/* Main Master-Detail Layout */}
      <div className="param-layout">
        {/* Left Providers Sidebar Navigation */}
        <aside className="param-sidebar">
          <div className="param-sidebar-header">
            <div className="param-sidebar-title-row">
              <span className="param-sidebar-label">Tool Families</span>
              <span className="param-provider-count">{uniqueTools.length}</span>
            </div>
            <div className="param-sidebar-search">
              <Search size={13} color="var(--muted)" />
              <input
                type="search"
                placeholder="Filter tools…"
                value={providerSearch}
                onChange={e => setProviderSearch(e.target.value)}
              />
              {providerSearch && (
                <button
                  onClick={() => setProviderSearch('')}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <nav className="param-sidebar-list">
            {/* All Providers Option */}
            <button
              type="button"
              className={`param-provider-item ${selectedTool === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedTool('ALL')}
            >
              <div className="param-provider-info">
                <div className="param-provider-icon">
                  <Boxes size={14} />
                </div>
                <div className="param-provider-names">
                  <span className="param-provider-name">All Tool Families</span>
                  <span className="param-provider-syskey">{uniqueTools.length} system domains</span>
                </div>
              </div>
              <div className="param-provider-badges">
                {stats.overridden > 0 && <span className="param-override-indicator" title="Has active overrides" />}
                <span className="param-provider-count">{parameters.length}</span>
              </div>
            </button>

            {/* Individual Provider Tools */}
            {filteredSidebarTools.map(toolKey => {
              const meta = getToolMeta(toolKey, templates);
              const toolParams = toolsMap.get(toolKey) || [];
              const hasOverrides = toolParams.some(p => p.override_revision && p.override_revision > 0);
              const isSelected = selectedTool === toolKey;

              return (
                <button
                  key={toolKey}
                  type="button"
                  className={`param-provider-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedTool(toolKey)}
                >
                  <div className="param-provider-info">
                    <div className="param-provider-icon">{meta.icon}</div>
                    <div className="param-provider-names">
                      <span className="param-provider-name">{meta.displayName}</span>
                      <span className="param-provider-syskey">{toolKey}</span>
                    </div>
                  </div>
                  <div className="param-provider-badges">
                    {hasOverrides && (
                      <span className="param-override-indicator" title="Has active project overrides" />
                    )}
                    <span className="param-provider-count">{toolParams.length}</span>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right Main Workspace */}
        <main className="param-workspace">
          {/* Filter & Search Toolbar */}
          <div className="param-toolbar">
            <div className="param-search-input-wrap">
              <Search size={14} color="var(--muted)" />
              <input
                type="search"
                placeholder="Search by key, description, category, subcategory, or value…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Type Select */}
              <select
                className="param-type-select"
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                aria-label="Filter by value type"
              >
                <option value="ALL">All Types</option>
                <option value="string">String</option>
                <option value="integer">Integer</option>
                <option value="number">Number</option>
                <option value="boolean">Boolean</option>
                <option value="json">JSON</option>
                <option value="secret_ref">Secret Reference</option>
              </select>

              {/* Status Select (Reachable governance control) */}
              <select
                className="param-type-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                aria-label="Filter parameter governance status"
              >
                <option value="ALL">All Statuses</option>
                <option value="OVERRIDDEN">Overrides ({stats.overridden})</option>
                <option value="DEFAULT">Deployment Defaults</option>
                <option value="CAN_OVERRIDE">Project Overridable</option>
                <option value="LOCKED">Platform Policy Enforced</option>
              </select>

              {/* Scope Select */}
              <select
                className="param-type-select"
                value={scopeFilter}
                onChange={e => setScopeFilter(e.target.value as typeof scopeFilter)}
                aria-label="Filter parameter scope"
              >
                <option value="ALL">All Scopes</option>
                <option value="platform_only">Platform Policy (Locked)</option>
                <option value="project">Project Workspace</option>
                <option value="platform">Platform Baseline</option>
              </select>

              {/* Expand/Collapse All when in ALL mode */}
              {selectedTool === 'ALL' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                  onClick={() => {
                    const anyCollapsed = Object.values(collapsedTools).some(Boolean);
                    setAllCollapsed(!anyCollapsed);
                  }}
                  title="Expand or collapse all provider groups"
                >
                  {Object.values(collapsedTools).some(Boolean) ? 'Expand All' : 'Collapse All'}
                </button>
              )}
            </div>
          </div>

          {/* Taxonomy Filter Chips Strip */}
          <div className="param-filter-chips-bar" style={{ padding: '8px 20px', borderBottom: '1px solid var(--line)' }}>
            {/* Category Filter Chips */}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginRight: 4 }}>
              Category:
            </span>
            <button
              type="button"
              className={`param-filter-chip ${categoryFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => {
                setCategoryFilter('ALL');
                setSubcategoryFilter('ALL');
              }}
            >
              All
            </button>
            {availableCategories.map(cat => (
              <button
                key={cat}
                type="button"
                className={`param-filter-chip ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => {
                  const next = categoryFilter === cat ? 'ALL' : cat;
                  setCategoryFilter(next);
                  setSubcategoryFilter('ALL');
                }}
              >
                {cat}
              </button>
            ))}

            {/* Effective State Filter Chips */}
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginLeft: 12, marginRight: 4 }}>
              State:
            </span>
            <button
              type="button"
              className={`param-filter-chip ${effectiveStateFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setEffectiveStateFilter('ALL')}
            >
              All States
            </button>
            <button
              type="button"
              className={`param-filter-chip ${effectiveStateFilter === 'SET' ? 'active' : ''}`}
              onClick={() => setEffectiveStateFilter(effectiveStateFilter === 'SET' ? 'ALL' : 'SET')}
            >
              SET ({stats.set})
            </button>
            <button
              type="button"
              className={`param-filter-chip ${effectiveStateFilter === 'INHERIT' ? 'active' : ''}`}
              onClick={() => setEffectiveStateFilter(effectiveStateFilter === 'INHERIT' ? 'ALL' : 'INHERIT')}
            >
              INHERIT ({stats.inherit})
            </button>
            <button
              type="button"
              className={`param-filter-chip ${effectiveStateFilter === 'DISABLED' ? 'active' : ''}`}
              onClick={() => setEffectiveStateFilter(effectiveStateFilter === 'DISABLED' ? 'ALL' : 'DISABLED')}
            >
              DISABLED ({stats.disabled})
            </button>

            {/* Contextual Subcategory Chips if Category is chosen */}
            {categoryFilter !== 'ALL' && availableSubcategories.length > 0 && (
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--line)' }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginRight: 4 }}>
                  Subcategory ({categoryFilter}):
                </span>
                <button
                  type="button"
                  className={`param-filter-chip ${subcategoryFilter === 'ALL' ? 'active' : ''}`}
                  onClick={() => setSubcategoryFilter('ALL')}
                >
                  All Subcategories
                </button>
                {availableSubcategories.map(subcat => (
                  <button
                    key={subcat}
                    type="button"
                    className={`param-filter-chip ${subcategoryFilter === subcat ? 'active' : ''}`}
                    onClick={() => setSubcategoryFilter(subcategoryFilter === subcat ? 'ALL' : subcat)}
                  >
                    {subcat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Workspace Content */}
          <div className="param-content-area">
            {/* Notices & Errors */}
            {error && (
              <NotificationBanner
                type="error"
                message={error}
                onClose={() => setError(null)}
                style={{ marginBottom: 16 }}
              />
            )}

            {notice && (
              <NotificationBanner
                type={notice.type}
                message={notice.message}
                onClose={() => setNotice(null)}
                style={{ marginBottom: 16 }}
              />
            )}

            {/* Loading State */}
            {loading && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
                <p>Loading parameters from deployment runtime…</p>
              </div>
            )}

            {/* Empty State */}
            {!loading && filteredParameters.length === 0 && (
              <div className="notice-banner" style={{ textAlign: 'center', padding: 40 }}>
                <Sliders size={26} color="var(--muted)" style={{ margin: '0 auto 10px' }} />
                <h3 style={{ margin: 0, fontSize: 15 }}>No matching parameters</h3>
                <p className="metric-meta" style={{ marginTop: 4 }}>
                  No parameters matched the active filters ({categoryFilter !== 'ALL' ? `Category: ${categoryFilter}` : ''} {subcategoryFilter !== 'ALL' ? `Subcategory: ${subcategoryFilter}` : ''} {effectiveStateFilter !== 'ALL' ? `State: ${effectiveStateFilter}` : ''}).
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setSelectedTool('ALL');
                      setSearchQuery('');
                      setTypeFilter('ALL');
                      setStatusFilter('ALL');
                      setScopeFilter('ALL');
                      setCategoryFilter('ALL');
                      setSubcategoryFilter('ALL');
                      setEffectiveStateFilter('ALL');
                    }}
                  >
                    Reset All Filters
                  </button>
                  {canOverride && (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        resetNewParameterForm();
                        setIsAddOpen(true);
                      }}
                    >
                      <Plus size={13} /> Add Parameter
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* View Mode: Single Tool Selected */}
            {!loading && selectedTool !== 'ALL' && activeSelectedMeta && (
              <div>
                {/* Active Provider Header Banner */}
                <div className="param-active-provider-header">
                  <div className="param-active-provider-info">
                    <div className="param-active-provider-avatar">{activeSelectedMeta.icon}</div>
                    <div>
                      <h2 className="param-active-provider-title">
                        {activeSelectedMeta.displayName}
                        <span className="param-active-provider-syskey">{selectedTool}</span>
                      </h2>
                      <p className="param-active-provider-desc">{activeSelectedMeta.description}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                      {filteredParameters.length} parameters
                    </span>
                    {filteredParameters.filter(p => p.override_revision && p.override_revision > 0).length > 0 && (
                      <span className="badge badge-active" style={{ fontSize: '11px' }}>
                        {filteredParameters.filter(p => p.override_revision && p.override_revision > 0).length} overridden
                      </span>
                    )}
                    {canOverride && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 10px' }}
                        onClick={() => {
                          resetNewParameterForm({ tool: selectedTool });
                          setIsAddOpen(true);
                        }}
                      >
                        <Plus size={12} /> Add to {activeSelectedMeta.displayName}
                      </button>
                    )}
                  </div>
                </div>

                {/* Table View */}
                {viewMode === 'table' ? (
                  <div className="param-table-container" style={{ marginTop: 14 }}>
                    <table className="param-table">
                      <thead>
                        <tr>
                          <th>Parameter & Operational Taxonomy</th>
                          <th>Type</th>
                          <th>Effective Value</th>
                          <th>Status / Scope</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredParameters.map(renderTableRow)}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* Cards View */
                  <div className="param-cards-grid" style={{ marginTop: 14 }}>
                    {filteredParameters.map(renderCard)}
                  </div>
                )}
              </div>
            )}

            {/* View Mode: All Providers Grouped by Tool -> Category */}
            {!loading && selectedTool === 'ALL' && filteredToolsMap.size > 0 && (
              Array.from(filteredToolsMap.entries()).map(([toolKey, catMap]) => {
                const meta = getToolMeta(toolKey, templates);
                const isCollapsed = Boolean(collapsedTools[toolKey]);
                const allToolParams = Array.from(catMap.values()).flat();
                const toolOverrideCount = allToolParams.filter(p => p.override_revision && p.override_revision > 0).length;

                return (
                  <section key={toolKey} className="param-tool-group">
                    {/* Tool Header */}
                    <div
                      className="param-tool-group-header"
                      onClick={() => toggleCollapseTool(toolKey)}
                      title="Click to toggle tool parameters"
                    >
                      <div className="param-tool-info">
                        <div className="param-tool-avatar">{meta.icon}</div>
                        <div className="param-tool-titles">
                          <h3>
                            {meta.displayName}
                            <span className="param-tool-system-tag">{toolKey}</span>
                          </h3>
                          <p className="param-tool-desc">{meta.description}</p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-neutral" style={{ fontSize: '11px' }}>
                          {allToolParams.length}
                        </span>
                        {toolOverrideCount > 0 && (
                          <span className="badge badge-active" style={{ fontSize: '11px' }}>
                            {toolOverrideCount} overridden
                          </span>
                        )}
                        <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
                          {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        </span>
                      </div>
                    </div>

                    {/* Content when not collapsed */}
                    {!isCollapsed && (
                      <div style={{ padding: '8px 0' }}>
                        {Array.from(catMap.entries()).map(([catKey, catParams]) => (
                          <div key={catKey} className="param-category-group">
                            <div className="param-category-subbar">
                              <span className="param-category-tag">
                                <Layers size={12} color="var(--acc)" />
                                {catKey}
                              </span>
                              <span className="param-category-count">
                                {catParams.length} parameter{catParams.length === 1 ? '' : 's'}
                              </span>
                            </div>

                            {viewMode === 'table' ? (
                              <div className="param-table-container" style={{ marginBottom: 12 }}>
                                <table className="param-table">
                                  <thead>
                                    <tr>
                                      <th>Parameter & Operational Taxonomy</th>
                                      <th>Type</th>
                                      <th>Effective Value</th>
                                      <th>Status / Scope</th>
                                      <th style={{ textAlign: 'right' }}>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {catParams.map(renderTableRow)}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="param-cards-grid" style={{ marginBottom: 14 }}>
                                {catParams.map(renderCard)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* Slide-Over Drawer Inspector (Portaled to document.body) */}
      {drawerPortal}

      {/* Add Parameter Modal (Portaled to document.body) */}
      {addParameterModal}
    </div>
  );
}
