import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, MonoTypeOperatorFunction, Observable, throwError } from 'rxjs';
import { CreateLeaveRequest, Employee, LeaveRequest } from '../models/leave-request.model';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class LeaveRequestsApiService {
  private readonly baseUrl = 'http://localhost:5080/api';

  constructor(private readonly http: HttpClient) {}

  getRequests(): Observable<LeaveRequest[]> {
    return this.http.get<LeaveRequest[]>(`${this.baseUrl}/leave-requests`).pipe(this.handleErrors());
  }

  getEmployees(): Observable<Employee[]> {
    return this.http.get<Employee[]>(`${this.baseUrl}/employees`).pipe(this.handleErrors());
  }

  getRequest(id: number): Observable<LeaveRequest> {
    return this.http.get<LeaveRequest>(`${this.baseUrl}/leave-requests/${id}`).pipe(this.handleErrors());
  }

  createRequest(payload: CreateLeaveRequest): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.baseUrl}/leave-requests`, payload).pipe(this.handleErrors());
  }

  approveRequest(id: number): Observable<LeaveRequest> {
    return this.http.post<LeaveRequest>(`${this.baseUrl}/leave-requests/${id}/approve`, {}).pipe(this.handleErrors());
  }

  private handleErrors<T>(): MonoTypeOperatorFunction<T> {
    return catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) {
        return throwError(() => new ApiError(0, 'Unexpected connection error'));
      }
      const body: unknown = error.error;
      const message = typeof body === 'string' ? body
        : body !== null && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message : error.message;
      return throwError(() => new ApiError(error.status, message));
    });
  }
}
