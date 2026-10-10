export async function configuredUnitError(supabase, unit, listingType) {
  if (!unit) return null;
  if (unit.startsWith('other:')) {
    const custom = unit.slice(6).trim().replace(/\s+/g, ' ');
    return /^[\p{L}\p{N} .,'-]{1,20}$/u.test(custom)
      ? null
      : 'Enter a short, valid custom pricing unit.';
  }
  const { data, error } = await supabase
    .from('catalogue_units')
    .select('key, label, applies_to, is_active')
    .eq('is_active', true);
  if (error?.code === '42P01') return null;
  if (error) {
    console.error('Catalogue unit configuration lookup error:', error);
    return 'Could not validate pricing unit.';
  }
  const normalized = unit.trim().toLowerCase();
  const valid = (data || []).some((entry) =>
    (entry.key.toLowerCase() === normalized || entry.label.toLowerCase() === normalized)
      && entry.applies_to.includes(listingType));
  return valid ? null : 'Choose a pricing unit configured for this listing type.';
}

export async function configuredAttributesError(supabase, attributes, categoryId, listingType, { requireRequiredFields = true } = {}) {
  const { data, error } = await supabase
    .from('catalogue_attribute_definitions')
    .select('id, category_id, listing_type, key, label, input_type, options, is_required, allow_other, min_number, max_number, is_active')
    .eq('is_active', true)
    .or(`category_id.is.null,category_id.eq.${categoryId}`);
  if (error?.code === '42P01') return null;
  if (error) {
    console.error('Catalogue attribute configuration lookup error:', error);
    return 'Could not validate category fields.';
  }
  const definitions = (data || []).filter((definition) =>
    (!definition.listing_type || definition.listing_type === listingType));
  const provided = new Map();
  const customLabels = new Set();
  for (const attribute of attributes) {
    if (attribute.attribute_id) {
      const definition = definitions.find((item) => item.id === attribute.attribute_id);
      if (!definition) return 'A listing field is no longer available for this category.';
      const value = attribute.value;
      const emptyValue = value === null || value === '' || (Array.isArray(value) && value.length === 0);
      if (emptyValue) {
        if (requireRequiredFields && definition.is_required) return `${definition.label} is required.`;
      } else if (definition.input_type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)
          || (definition.min_number !== null && value < Number(definition.min_number))
          || (definition.max_number !== null && value > Number(definition.max_number))) {
          return `Enter a valid value for ${definition.label}.`;
        }
      } else if (definition.input_type === 'boolean') {
        if (typeof value !== 'boolean') return `Choose a valid value for ${definition.label}.`;
      } else if (definition.input_type === 'select' || definition.input_type === 'multi_select') {
        const options = Array.isArray(definition.options) ? definition.options : [];
        const validOption = (option) => options.some((entry) => (typeof entry === 'string' ? entry : entry?.value) === option);
        const values = definition.input_type === 'multi_select' ? value : [value];
        if (!Array.isArray(values) || values.some((entry) => typeof entry !== 'string' || !validOption(entry))) {
          return `Choose an available option for ${definition.label}.`;
        }
      } else if (typeof value !== 'string' || value.length > 1000) {
        return `Enter valid text for ${definition.label}.`;
      }
      provided.set(definition.id, value);
    } else {
      const label = attribute.custom_label.toLowerCase();
      if (!definitions.some((definition) => definition.allow_other)) return 'Custom fields are not enabled for this category.';
      if (customLabels.has(label)) return 'Custom field names must be unique.';
      customLabels.add(label);
    }
  }
  const missing = requireRequiredFields && definitions.find((definition) => definition.is_required && !provided.has(definition.id));
  return missing ? `${missing.label} is required.` : null;
}
