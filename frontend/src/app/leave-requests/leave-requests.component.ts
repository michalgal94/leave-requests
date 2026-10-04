import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { catchError, concatMap, dematerialize, finalize, map, materialize, mergeMap, of, tap, throwError, timer } from 'rxjs';
import { CreateLeaveRequest, Employee, LeaveRequest, LeaveStatus, LeaveType } from '../models/leave-request.model';
import { ApiError, LeaveRequestsApiService } from '../services/leave-requests-api.service';
import { AvailableRange, availableLeaveRanges } from './leave-availability';

function dateRangeValidator(control: AbstractControl): ValidationErrors | null {
  const startDate: unknown = control.get('startDate')?.value;
  const endDate: unknown = control.get('endDate')?.value;
  return typeof startDate === 'string' && typeof endDate === 'string'
    && startDate && endDate && startDate > endDate ? { dateOrder: true } : null;
}

@Component({
  selector: 'app-leave-requests',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './leave-requests.component.html',
  styleUrls: ['./leave-requests.component.css']
})
export class LeaveRequestsComponent implements OnInit {
  readonly requests = signal<LeaveRequest[]>([]);
  loading = false;
  loadError = '';
  approvalNotice = '';
  readonly unsyncedApprovalIds = new Set<number>();
  readonly employees = signal<Employee[]>([]);
  employeesLoading = false;
  employeesError = '';
  submitting = false;
  submitError = '';
  submitSuccess = '';
  readonly approvingIds = new Set<number>();
  readonly approvalErrors: Record<number, string> = {};
  readonly approvalSuccesses: Record<number, string> = {};
  readonly requestForm = new FormGroup({
    employeeId: new FormControl<number | null>(null, Validators.required),
    type: new FormControl<LeaveType | null>(null, Validators.required),
    startDate: new FormControl('', { nonNullable: true, validators: Validators.required }),
    endDate: new FormControl('', { nonNullable: true, validators: Validators.required })
  }, { validators: dateRangeValidator });

  get requestedDays(): number | null {
    const { startDate, endDate } = this.requestForm.getRawValue();
    if (!startDate || !endDate || startDate > endDate) return null;
    const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000 + 1;
    return Number.isInteger(days) && days > 0 ? days : null;
  }

  get overlappingRequest(): LeaveRequest | undefined {
    const { employeeId, startDate, endDate } = this.requestForm.getRawValue();
    if (!employeeId || !startDate || !endDate || startDate > endDate) return undefined;
    return this.requests().find(request => request.employeeId === employeeId
      && (request.status === 0 || request.status === 1)
      && request.startDate <= endDate && request.endDate >= startDate);
  }

  get availableRanges(): AvailableRange[] {
    const { employeeId, startDate, endDate } = this.requestForm.getRawValue();
    return availableLeaveRanges(startDate, endDate,
      this.requests().filter(request => request.employeeId === employeeId));
  }

  formatRange(range: { startDate: string; endDate: string }): string {
    const format = (date: string): string => date.split('-').reverse().join('/');
    return range.startDate === range.endDate ? format(range.startDate)
      : `${format(range.startDate)} – ${format(range.endDate)}`;
  }

  get overlapMessage(): string {
    if (!this.overlappingRequest) return '';
    const { employeeId, startDate, endDate } = this.requestForm.getRawValue();
    const covered = this.requests().filter(request => request.employeeId === employeeId
      && (request.status === 0 || request.status === 1)
      && request.startDate <= endDate && request.endDate >= startDate);
    const describe = (status: number): string => covered.filter(request => request.status === status)
      .map(request => this.formatRange({ startDate: request.startDate < startDate ? startDate : request.startDate,
        endDate: request.endDate > endDate ? endDate : request.endDate })).join(', ');
    const approved = describe(1);
    const pending = describe(0);
    const details = [approved ? `You already have approved leave on ${approved}.` : '',
      pending ? `You already have requests awaiting approval for ${pending}.` : ''].filter(Boolean).join(' ');
    const ranges = this.availableRanges;
    const days = ranges.reduce((sum, range) => sum + range.days, 0);
    return days === 0 ? `${details} No dates are available in the selected range. Please choose different dates.`
      : `${details} You can request ${days === 1 ? 'only 1 day of leave' : `${days} days of leave`} within this range: ${ranges.map(range => this.formatRange(range)).join(', ')}. Select an available range and submit it for approval.`;
  }

  selectAvailableRange(range: AvailableRange): void {
    this.requestForm.patchValue({ startDate: range.startDate, endDate: range.endDate });
  }

  private readonly destroyRef = inject(DestroyRef);

  constructor(private readonly api: LeaveRequestsApiService) {}

  ngOnInit(): void {
    this.requestForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.submitError = '';
      this.submitSuccess = '';
    });
    this.load();
    this.loadEmployees();
  }

  loadEmployees(): void {
    if (this.employeesLoading) return;
    this.employeesLoading = true;
    this.employeesError = '';
    this.api.getEmployees()
      .pipe(finalize(() => this.employeesLoading = false), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: employees => this.employees.set(employees),
        error: () => this.employeesError = 'Could not load employees. Please try again.'
      });
  }

  submitRequest(): void {
    if (this.submitting) return;
    this.submitError = '';
    this.submitSuccess = '';
    this.requestForm.markAllAsTouched();
    if (this.requestForm.invalid || this.requestedDays === null) return;
    if (this.loading || this.loadError) {
      this.submitError = 'Please wait for existing requests to load before submitting a new request.';
      return;
    }
    if (this.overlappingRequest) {
      this.submitError = this.overlapMessage;
      return;
    }

    const values = this.requestForm.getRawValue();
    if (values.employeeId === null || values.type === null) return;
    const payload: CreateLeaveRequest = { ...values, employeeId: values.employeeId, type: values.type };
    this.submitting = true;
    this.api.createRequest(payload)
      .pipe(finalize(() => this.submitting = false), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: request => {
          const created = { ...request, employee: request.employee ?? this.employees().find(employee => employee.id === request.employeeId) };
          this.requests.update(requests => [created, ...requests]
            .sort((a, b) => b.startDate.localeCompare(a.startDate)));
          this.requestForm.reset();
          this.submitSuccess = `Your request for ${request.days === 1 ? '1 day' : `${request.days} days`} of leave on ${this.formatRange(request)} has been submitted and is awaiting approval.`;
        },
        error: (error: ApiError) => {
          const message = error.message;
          if (message === 'Not enough vacation balance') {
            const employee = this.employees().find(employee => employee.id === payload.employeeId);
            const used = this.requests().filter(request => request.employeeId === payload.employeeId
              && request.type === 0 && request.status === 1).reduce((sum, request) => sum + request.days, 0);
            this.submitError = `You do not have enough vacation days for this request.${employee ? ` Based on the displayed requests, you have ${Math.max(0, employee.annualQuota - used)} days remaining.` : ''} Please choose a shorter range.`;
          } else if (message?.includes('overlap')) {
            this.submitError = 'Some selected dates have since been included in another request. Your requests are being refreshed; select an available range once the update completes.';
            this.load();
          } else {
            this.submitError = error.status === 0
              ? 'Could not connect to the server. Your details are still in the form; try submitting again when the connection is restored.'
              : 'Could not submit your request. Your details are still in the form; check the fields and try again.';
          }
        }
      });
  }

  load(): void {
    if (this.loading) return;
    this.loading = true;
    this.loadError = '';
    this.api.getRequests()
      .pipe(finalize(() => this.loading = false), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: data => this.requests.set(data),
        error: () => this.loadError = 'Could not load leave requests. Please try again.'
      });
  }

  approve(id: number): void {
    const current = this.requests().find(request => request.id === id);
    if (!current || current.status !== 0 || this.approvingIds.has(id) || this.unsyncedApprovalIds.has(id)) return;

    delete this.approvalErrors[id];
    delete this.approvalSuccesses[id];
    this.approvingIds.add(id);
    const startedAt = Date.now();
    this.api.approveRequest(id)
      .pipe(
        catchError((error: ApiError) => {
          if (error.status !== 404 && error.status !== 409) {
            return throwError(() => error);
          }
          // Refresh only this row before releasing its button after a stale-status error.
          return this.api.getRequest(id).pipe(
            tap(updated => {
              this.requests.update(requests => requests.map(request => request.id === id ? updated : request));
            }),
            catchError((refreshError: ApiError) => {
              if (refreshError.status === 404) {
                this.requests.update(requests => requests.filter(request => request.id !== id));
                this.approvalNotice = 'The request no longer exists and was removed from the list.';
              } else {
                this.unsyncedApprovalIds.add(id);
              }
              return of(null);
            }),
            mergeMap(() => throwError(() => error))
          );
        }),
        // Keep both success and error feedback behind the minimum loading time.
        materialize(),
        concatMap(notification => timer(Math.max(0, 800 - (Date.now() - startedAt)))
          .pipe(map(() => notification))),
        dematerialize(),
        finalize(() => this.approvingIds.delete(id)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: approved => {
          this.requests.update(requests => requests.map(request => request.id === id
            ? { ...approved, employee: approved.employee ?? request.employee }
            : request));
          this.approvalSuccesses[id] = 'Request approved successfully.';
        },
        error: (error: ApiError) => {
          const message = error.message;
          if (error.status === 404) {
            this.approvalErrors[id] = 'This request no longer exists.';
          } else if (message === 'Only pending leave requests can be approved') {
            this.approvalErrors[id] = 'This request has already been approved or rejected.';
          } else if (message === 'Not enough vacation balance') {
            const rejected = this.requests().find(request => request.id === id)?.status === LeaveStatus.Rejected;
            this.approvalErrors[id] = rejected
              ? 'Request rejected: not enough vacation balance.'
              : 'Not enough vacation balance to approve this request.';
          } else {
            this.approvalErrors[id] = error.status === 0
              ? 'Could not connect to the server. Please try again.'
              : 'Could not approve the request. Please try again.';
          }
          if (this.unsyncedApprovalIds.has(id)) {
            this.approvalErrors[id] += ' Could not refresh its status. Refresh the page before trying again.';
          }
        }
      });
  }

  typeLabel(type: LeaveType): string {
    if (type == 0) return 'Vacation';
    if (type == 1) return 'Sick';
    return 'Unpaid';
  }

  statusLabel(status: LeaveStatus): string {
    if (status == 0) return 'Pending';
    if (status == 1) return 'Approved';
    return 'Rejected';
  }
}
