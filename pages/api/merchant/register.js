// Legacy path kept for older callers. It used to be a separate copy of the
// registration logic that signed tokens with { merchantId } instead of
// { id }, so every merchant-scoped route rejected them. Now it is the same
// handler as pages/api/merchants/register.js.
export { default } from '../merchants/register';
