import { HttpStatus } from '@nestjs/common';
import { canUseBranch } from '@pos/domain';
import { AppException } from './app-exception';
import type { AuthPrincipal } from './request-context';

/** Members restricted to some branches may not act on others (owners are never restricted). */
export function assertBranchAllowed(principal: AuthPrincipal | undefined, branchId: string): void {
  if (!principal || canUseBranch(principal.branchIds, branchId)) return;
  throw new AppException(
    'BRANCH_NOT_ALLOWED',
    HttpStatus.FORBIDDEN,
    'You are not assigned to this branch.',
  );
}

/** Branch filter for lists: the caller's branches, or none when unrestricted. */
export function allowedBranchFilter(principal: AuthPrincipal | undefined) {
  return principal?.branchIds ? { in: [...principal.branchIds] } : undefined;
}
