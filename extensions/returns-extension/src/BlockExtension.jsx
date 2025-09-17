// /extensions/csd-entry-block/src/BlockExtension.jsx
import {
  reactExtension,
  AdminBlock,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  TextArea,
  Checkbox,
  Select,
  DateField,
  Button,
  Banner,
  Divider,
  Box,
  useApi,
} from '@shopify/ui-extensions-react/admin';
import { useState, useEffect } from 'react';

const TARGET = 'admin.order-details.block.render';
const DEBUG = false; // set true to log useApi payload

// Main/cross-axis alignment for rows
const ROW_MAIN_ALIGN = 'space-between';    // distribute fields across the row evenly
const ROW_CROSS_ALIGN = 'center';          // keep fields vertically centered per row

// Control the space between fields in a row (InlineStack spacing tokens)
// Allowed: 'none' | 'extraTight' | 'tight' | 'base' | 'loose'
const TOP_ROW_GAP = 'loose';
const CORE_ROW_GAP = 'base';
const OPTIONAL_ROW_GAP = 'tight';

// span: 12 = full, 6 = half, 4 = third (use any values that sum to <= 12 per row)
// maxLength: optional character limit for text inputs/areas
// widthPx / minWidthPx / maxWidthPx: optional pixel-based sizing for the rendered field (wrapped in a Box)
// hidden: when true, the field is included in state/payload but not rendered
const FIELD_DEFS = [
  { label: 'Service ID', name: 'serviceID', type: 'text', span: 6, maxLength: 50, hidden: true },
  { label: 'Return Request Date', name: 'dateOfReturnRequest', type: 'date', span: 4, labelHidden: true, widthPx: 160, hidden: true },
  { label: 'Order #', name: 'originalOrderNumber', type: 'text', span: 4, maxLength: 40, labelHidden: true, widthPx: 80, hidden: true },
  { label: 'Customer', name: 'customerName', type: 'text', span: 4, maxLength: 100, labelHidden: true, widthPx: 300, hidden: true},
  { label: 'Customer Reported Reason Category', name: 'primaryReason', type: 'select', span: 2, maxLength: 2000 },
  { label: 'Item', name: 'item', type: 'text', span: 6, maxLength: 120, widthPx: 200, hidden: true },
  { label: 'Replacement #', name: 'replacementOrderNumber', type: 'text', span: 6, maxLength: 40, widthPx: 100 },
  { label: 'Return Type', name: 'returnType', type: 'select', span: 6, maxLength: 120, widthPx: 200 },
  { label: 'Troubleshooting Category', name: 'troubleshootingCategory', type: 'select', span: 2, maxLength: 30 },
  { label: 'Troubleshooting Notes', name: 'troubleshootingNotes', type: 'text', span: 12, maxLength: 3000 },
  { label: 'Customer Service Status', name: 'customerServiceStatus', type: 'text', span: 2, maxLength: 80, widthPx: 200, hidden: true},
  { label: 'Customer Service Rep', name: 'rslCsd', type: 'text', span: 4, maxLength: 80, widthPx: 200, hidden: true },
  { label: 'Return Item Required', name: 'returnItemRequired', type: 'checkbox', span: 1, widthPx: 100 },
  { label: 'Repair Department Designation', name: 'repairDeptDesignation', type: 'text', span: 6, maxLength: 120, hidden: true },
];

// First line
const TOP_FIELD_NAMES = ['dateOfReturnRequest', 'returnType', 'replacementOrderNumber','returnItemRequired'];
// Keep the block short: show only these "core" fields in compact mode
const CORE_FIELD_NAMES = [
  'primaryReason','troubleshootingCategory', 'troubleshootingNotes',
];

const HIDDEN_FIELD_NAMES = ['serviceID', 'primaryReason', 'customerServiceStatus', 'rslCsd', 'dateOfReturnRequest', 'originalOrderNumber', 'customerName'];

export default reactExtension(TARGET, () => <CsdEntryBlock />);

function firstDefined() {
  for (let i = 0; i < arguments.length; i++) {
    if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
  }
  return null;
}

function groupIntoRows(fields) {
  const rows = [];
  let current = [];
  let sum = 0;
  fields.forEach((f) => {
    const span = f.span || 12;
    if (sum + span > 12 && current.length) {
      rows.push(current);
      current = [f];
      sum = span;
    } else {
      current.push(f);
      sum += span;
    }
  });
  if (current.length) rows.push(current);
  return rows;
}

function CsdEntryBlock() {
  const api = useApi();
  const data = api && api.data;

  const currentUserName = firstDefined(
    api && api.currentUser && (api.currentUser.displayName || api.currentUser.name),
    data && data.currentUser && (data.currentUser.displayName || data.currentUser.name),
    data && data.user && data.user.name
  );

  const orderIdFromData = firstDefined(
    data && data.order && data.order.id,
    data && data.selected && Array.isArray(data.selected) && data.selected[0] && data.selected[0].id,
    data && data.selected && data.selected.id,
    data && data.id
  );
  const orderNameFromData = firstDefined(
    data && data.order && data.order.name,
    data && data.selected && Array.isArray(data.selected) && data.selected[0] && data.selected[0].name,
    data && data.selected && data.selected.name,
    data && data.name
  );

  const initial = {};
  for (const f of FIELD_DEFS) initial[f.name] = f.type === 'checkbox' ? false : '';
  initial.orderGid = orderIdFromData || '';
  initial.orderName = orderNameFromData || '';
  if (currentUserName) initial.rslCsd = currentUserName;

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false); // compact by default

  const onChange = (name, value) => setValues((prev) => ({ ...prev, [name]: value }));

  // Prefill from local context
  useEffect(() => {
    setValues((prev) => {
      let next = prev;
      if (!prev.originalOrderNumber && orderNameFromData) next = { ...next, originalOrderNumber: orderNameFromData };
      if (!prev.customerName) {
        const customerName = firstDefined(
          data && data.order && data.order.customer && (data.order.customer.displayName || data.order.customer.name),
          data && data.customer && (data.customer.displayName || data.customer.name)
        );
        if (customerName) next = { ...next, customerName };
      }
      if (!prev.rslCsd && currentUserName) next = { ...next, rslCsd: currentUserName };
      if (!prev.orderGid && orderIdFromData) next = { ...next, orderGid: orderIdFromData };
      if (!prev.orderName && orderNameFromData) next = { ...next, orderName: orderNameFromData };
      return next;
    });
  }, [data, orderIdFromData, orderNameFromData, currentUserName]);

  // Authoritative fill via backend
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const orderGid = values.orderGid;
      const orderName = values.orderName;
      if (!orderGid && !orderName) return;
      try {
        const token = await shopify.session.getToken();
        const res = await fetch('/apps/csd-entry/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderGid, orderName }),
        });
        if (!res.ok) throw new Error(`Load failed (${res.status})`);
        const payload = await res.json();
        if (cancelled) return;
        setValues((prev) => {
          const next = { ...prev };
          if (!prev.orderGid && payload.orderGid) next.orderGid = payload.orderGid;
          if (!prev.originalOrderNumber && payload.orderNumber) next.originalOrderNumber = payload.orderNumber;
          if (!prev.customerName && payload.customerName) next.customerName = payload.customerName;
          return next;
        });
      } catch (e) {
        if (DEBUG) console.warn('CSD Entry load error:', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [values.orderGid, values.orderName]);

  if (DEBUG) console.info('[CSD Entry] useApi payload', api);

  const isVisible = (f) => !f.hidden;

  const topFields = TOP_FIELD_NAMES
    .map((n) => FIELD_DEFS.find((f) => f.name === n))
    .filter(Boolean)
    .filter(isVisible);

  const coreFields = CORE_FIELD_NAMES
    .map((n) => FIELD_DEFS.find((f) => f.name === n))
    .filter(Boolean)
    .filter(isVisible);

  const optionalFields = FIELD_DEFS
    .filter((f) => TOP_FIELD_NAMES.indexOf(f.name) === -1 && CORE_FIELD_NAMES.indexOf(f.name) === -1)
    .filter(isVisible);

  const topRows = groupIntoRows(topFields);
  const coreRows = groupIntoRows(coreFields);
  const optionalRows = groupIntoRows(optionalFields);

  return (
    <AdminBlock>
      <BlockStack spacing="tight">

        {/* First line — force full width & single row */}
        {topRows.map((row, i) =>
          i === 0 ? (
            <Box key={`top-${i}-full`} inlineSize="100%">
              <InlineStack
                spacing={TOP_ROW_GAP}
                wrap={false}
                alignment={ROW_MAIN_ALIGN}
                blockAlignment={ROW_CROSS_ALIGN}
              >
                {row.map((f) => (
                  <Field key={f.name} def={f} value={values[f.name]} onChange={onChange} />
                ))}
              </InlineStack>
            </Box>
          ) : (
            <InlineStack
              key={`top-${i}`}
              spacing={TOP_ROW_GAP}
              wrap
              alignment={ROW_MAIN_ALIGN}
              blockAlignment={ROW_CROSS_ALIGN}
            >
              {row.map((f) => (
                <Field key={f.name} def={f} value={values[f.name]} onChange={onChange} />
              ))}
            </InlineStack>
          )
        )}

        <Divider />

        {/* Core fields (always visible) */}
        {coreRows.map((row, i) => (
          <InlineStack
            key={`core-${i}`}
            spacing={CORE_ROW_GAP}
            wrap
            alignment={ROW_MAIN_ALIGN}
            blockAlignment={ROW_CROSS_ALIGN}
          >
            {row.map((f) => (
              <Field key={f.name} def={f} value={values[f.name]} onChange={onChange} />
            ))}
          </InlineStack>
        ))}

        {/* Toggle for optional fields to keep block short */}
        {!expanded && optionalFields.length > 0 ? (
          <InlineStack alignment="end">
            <Button kind="secondary" onPress={() => setExpanded(true)}>
              Show more details
            </Button>
          </InlineStack>
        ) : null}

        {expanded ? (
          <BlockStack spacing="tight">
            {optionalRows.map((row, i) => (
              <InlineStack
                key={`opt-${i}`}
                spacing={OPTIONAL_ROW_GAP}
                wrap
                alignment={ROW_MAIN_ALIGN}
                blockAlignment={ROW_CROSS_ALIGN}
              >
                {row.map((f) => (
                  <Field key={f.name} def={f} value={values[f.name]} onChange={onChange} />
                ))}
              </InlineStack>
            ))}
            <InlineStack alignment="end">
              <Button kind="secondary" onPress={() => setExpanded(false)}>
                Hide details
              </Button>
            </InlineStack>
          </BlockStack>
        ) : null}

        {/* Notices at the end to avoid extra height above */}
        {notice ? <Banner status="success" onDismiss={() => setNotice(null)}>{notice}</Banner> : null}
        {error ? <Banner status="critical" onDismiss={() => setError(null)}>{error}</Banner> : null}

        <InlineStack alignment="end">
          <Button kind="primary" loading={saving} onPress={() => handleSave(values, setSaving, setNotice, setError)}>
            Save Entry
          </Button>
        </InlineStack>
      </BlockStack>
    </AdminBlock>
  );
}

function Field(props) {
  const def = props.def;
  const value = props.value;
  const onChange = props.onChange;
  if (def.hidden) return null; // respect hidden flag

  const label = def.label;
  const name = def.name;
  const type = def.type;
  const maxLength = def.maxLength;

  const content = (() => {
    if (type === 'text') return <TextField label={label} labelHidden={def.labelHidden} placeholder={def.placeholder} value={value} onChange={(v) => onChange(name, v)} maxLength={maxLength} />;
    if (type === 'textarea') return <TextArea label={label} labelHidden={def.labelHidden} placeholder={def.placeholder} value={value} onChange={(v) => onChange(name, v)} maxLength={maxLength} />;
    if (type === 'checkbox') return <Checkbox label={label} checked={!!value} onChange={(v) => onChange(name, v)} />;
    if (type === 'select') return <Select label={label} labelHidden={def.labelHidden} placeholder={def.placeholder} options={def.options || []} value={value} onChange={(v) => onChange(name, v)} />;
    if (type === 'date') return <DateField label={label} labelHidden={def.labelHidden} value={value} onChange={(v) => onChange(name, v)} />;
    return <TextField label={label} labelHidden={def.labelHidden} value={value} onChange={(v) => onChange(name, v)} maxLength={maxLength} />;
  })();

  // Pixel-based sizing wrapper using Box. If width constraints are provided, apply them.
  const hasWidth = def.widthPx || def.minWidthPx || def.maxWidthPx;
  if (hasWidth) {
    const minInlineSize = def.minWidthPx ? `${def.minWidthPx}px` : undefined;
    const maxInlineSize = def.maxWidthPx ? `${def.maxWidthPx}px` : undefined;
    const inlineSize = def.widthPx ? `${def.widthPx}px` : undefined;
    return (
      <Box minInlineSize={minInlineSize} maxInlineSize={maxInlineSize} inlineSize={inlineSize}>
        {content}
      </Box>
    );
  }

  return content;
}

async function handleSave(values, setSaving, setNotice, setError) {
  setSaving(true);
  setNotice(null);
  setError(null);
  try {
    const token = await shopify.session.getToken();
    const res = await fetch('/apps/csd-entry/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error('Save failed');
    const data = await res.json();
    setNotice((data && data.message) || 'CSD entry saved');
  } catch (e) {
    setError((e && e.message) || 'Something went wrong');
  } finally {
    setSaving(false);
  }
}
