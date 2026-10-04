import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { catchError, concatMap, dematerialize, finalize, map, materialize, mergeMap, of, tap, throwError, timer } from 'rxjs';
import { Employee, LeaveRequest } from '../models/leave-request.model';

function dateRangeValidator(control: AbstractControl): ValidationErrors | null {
  const { startDate, endDate } = control.value;
  return startDate && endDate && startDate > endDate ? { dateOrder: true } : null;
}

// NOTE: This component was written quickly for a POC.
// It talks to the API directly, manages state by hand and uses `any` everywhere.
@Component({
  selector: 'app-leave-requests',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './leave-requests.component.html',
  styleUrls: ['./leave-requests.component.css']
})
export class LeaveRequestsComponent implements OnInit {
  requests: any[] = [];
  loading = false;
  loadError = '';
  approvalNotice = '';
  readonly unsyncedApprovalIds = new Set<number>();
  employees: Employee[] = [];
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
    type: new FormControl<number | null>(null, Validators.required),
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
    return this.requests.find(request => request.employeeId === employeeId
      && (request.status === 0 || request.status === 1)
      && request.startDate <= endDate && request.endDate >= startDate);
  }

  private apiUrl = 'http://localhost:5080/api/leave-requests';
  private readonly destroyRef = inject(DestroyRef);

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.requestForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.submitError = '';
      this.submitSuccess = '';
    });
    this.load();
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.employeesLoading = true;
    this.employeesError = '';
    this.http.get<Employee[]>('http://localhost:5080/api/employees')
      .pipe(finalize(() => this.employeesLoading = false))
      .subscribe({
        next: employees => this.employees = employees,
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
      this.submitError = 'Please load the existing requests before submitting.';
      return;
    }
    if (this.overlappingRequest) {
      this.submitError = 'These dates overlap an existing pending or approved leave request for this employee.';
      return;
    }

    const payload = this.requestForm.getRawValue();
    this.submitting = true;
    this.http.post<LeaveRequest>(this.apiUrl, payload)
      .pipe(finalize(() => this.submitting = false))
      .subscribe({
        next: request => {
          request.employee = this.employees.find(employee => employee.id === request.employeeId);
          this.requests = [request, ...this.requests]
            .sort((a, b) => b.startDate.localeCompare(a.startDate));
          this.requestForm.reset();
          this.submitSuccess = 'Leave request submitted successfully.';
        },
        error: (error: HttpErrorResponse) => {
          this.submitError = typeof error.error === 'string' && error.error.trim()
            ? error.error
            : 'Could not submit the request. Please try again.';
        }
      });
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    this.http.get<LeaveRequest[]>(this.apiUrl)
      .pipe(finalize(() => this.loading = false))
      .subscribe({
        next: data => this.requests = data,
        error: () => this.loadError = 'Could not load leave requests. Please try again.'
      });
  }

  approve(id: number): void {
    const current = this.requests.find(request => request.id === id);
    if (!current || current.status !== 0 || this.approvingIds.has(id) || this.unsyncedApprovalIds.has(id)) return;

    delete this.approvalErrors[id];
    delete this.approvalSuccesses[id];
    this.approvingIds.add(id);
    const startedAt = Date.now();
    this.http.post<LeaveRequest>(`${this.apiUrl}/${id}/approve`, {})
      .pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status !== 404 && error.status !== 409) {
            return throwError(() => error);
          }
          // Refresh only this row before releasing its button after a stale-status error.
          return this.http.get<LeaveRequest>(`${this.apiUrl}/${id}`).pipe(
            tap(updated => {
              this.requests = this.requests.map(request => request.id === id ? updated : request);
            }),
            catchError((refreshError: HttpErrorResponse) => {
              if (refreshError.status === 404) {
                this.requests = this.requests.filter(request => request.id !== id);
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
        finalize(() => this.approvingIds.delete(id))
      )
      .subscribe({
        next: approved => {
          this.requests = this.requests.map(request => request.id === id
            ? { ...approved, employee: approved.employee ?? request.employee }
            : request);
          this.approvalSuccesses[id] = 'Request approved successfully.';
        },
        error: (error: HttpErrorResponse) => {
          const message = typeof error.error === 'string' ? error.error : error.error?.message;
          if (error.status === 404) {
            this.approvalErrors[id] = 'This request no longer exists.';
          } else if (message === 'Only pending leave requests can be approved') {
            this.approvalErrors[id] = 'This request has already been approved or rejected.';
          } else if (message === 'Not enough vacation balance') {
            const rejected = this.requests.find(request => request.id === id)?.status === 2;
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

  typeLabel(type: number): string {
    if (type == 0) return 'Vacation';
    if (type == 1) return 'Sick';
    return 'Unpaid';
  }

  statusLabel(status: number): string {
    if (status == 0) return 'Pending';
    if (status == 1) return 'Approved';
    return 'Rejected';
  }
}
