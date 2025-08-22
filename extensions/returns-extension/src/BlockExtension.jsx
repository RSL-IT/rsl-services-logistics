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
  useApi,
} from '@shopify/ui-extensions-react/admin';
import { useState, useEffect } from 'react';


const TARGET = 'admin.order-details.block.render';


const FIELD_DEFS = [
  { label: 'SERVICE NUMBER', name: 'serviceNumber', type: 'text' },
  { label: 'DATE OF RETURN REQUEST', name: 'dateOfReturnRequest', type: 'date' },
  { label: 'ORIGINAL ORDER #', name: 'originalOrderNumber', type: 'text' },
  { label: 'CUSTOMER NAME', name: 'customerName', type: 'text' },
  { label: 'PRIMARY CUSTOMER REPORTED REASON FOR RETURN/WARRANTY', name: 'primaryReason', type: 'textarea' },
  { label: 'ITEM', name: 'item', type: 'text' },
  { label: 'REPLACEMENT ORDER #', name: 'replacementOrderNumber', type: 'text' },
  { label: 'RETURN TYPE', name: 'returnType', type: 'text' },
  { label: 'TROUBLESHOOTING NOTES', name: 'troubleshootingNotes', type: 'textarea' },
  { label: 'CUSTOMER SERVICE STATUS', name: 'customerServiceStatus', type: 'text' },
  { label: 'RSL CSD', name: 'rslCsd', type: 'text' },
  { label: 'RETURN ITEM REQUIRED', name: 'returnItemRequired', type: 'checkbox' },
  { label: 'REPAIR DEPT. DESIGNATION', name: 'repairDeptDesignation', type: 'text' },
];


export default reactExtension(TARGET, () => <CsdEntryBlock />);


function CsdEntryBlock() {
  const { data } = useApi(TARGET);
  const orderGid = (data && (data.order?.id || data.selected?.id || data.id)) || null;


  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of FIELD_DEFS) v[f.name] = f.type === 'checkbox' ? false : '';
    v.orderGid = orderGid;
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);


  const onChange = (name, value) => setValues((prev) => ({ ...prev, [name]: value }));
}
