import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LeaveRequestsComponent } from './leave-requests.component';

describe('Leave requests', () => {
  let fixture: ComponentFixture<LeaveRequestsComponent>;
  let component: LeaveRequestsComponent;
  let http: HttpTestingController;
  const api = 'http://localhost:5080/api/leave-requests';
  const employee = { id: 1, name: 'Dana', annualQuota: 20 };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LeaveRequestsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    fixture = TestBed.createComponent(LeaveRequestsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne(api).flush([]);
    http.expectOne('http://localhost:5080/api/employees').flush([employee]);
  });

  afterEach(() => http.verify());

  function fillForm(): void {
    component.requestForm.setValue({
      employeeId: 1, type: 0, startDate: '2026-03-01', endDate: '2026-03-03'
    });
  }

  it('requires all fields and prevents submitting an empty form', () => {
    component.submitRequest();
    expect(component.requestForm.invalid).toBeTrue();
    for (const control of Object.values(component.requestForm.controls)) {
      expect(control.hasError('required')).toBeTrue();
      expect(control.touched).toBeTrue();
    }
    http.expectNone(request => request.method === 'POST');
  });

  it('requires a leave type while accepting Vacation code zero', () => {
    fillForm();
    expect(component.requestForm.valid).toBeTrue();
    component.requestForm.controls.type.setValue(null);
    component.submitRequest();
    expect(component.requestForm.controls.type.hasError('required')).toBeTrue();
    http.expectNone(request => request.method === 'POST');
  });

  it('rejects reversed dates and does not display negative days', () => {
    fillForm();
    component.requestForm.controls.endDate.setValue('2026-02-28');
    component.submitRequest();
    expect(component.requestForm.hasError('dateOrder')).toBeTrue();
    expect(component.requestedDays).toBeNull();
    http.expectNone(request => request.method === 'POST');
  });

  it('counts inclusive calendar days, including a single day and a daylight saving change', () => {
    fillForm();
    expect(component.requestedDays).toBe(3);
    component.requestForm.patchValue({ startDate: '2026-03-27', endDate: '2026-03-27' });
    expect(component.requestForm.valid).toBeTrue();
    expect(component.requestedDays).toBe(1);
    component.requestForm.patchValue({ startDate: '2026-03-26', endDate: '2026-03-28' });
    expect(component.requestedDays).toBe(3);
  });

  it('submits numeric employee/type values once and adds the saved request with its employee', () => {
    fillForm();
    component.submitRequest();
    component.submitRequest();
    const request = http.expectOne(api);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      employeeId: 1, type: 0, startDate: '2026-03-01', endDate: '2026-03-03'
    });
    expect(component.submitting).toBeTrue();
    request.flush({ id: 10, ...request.request.body, days: 3, status: 0 });
    expect(component.submitting).toBeFalse();
    expect(component.requests[0].employee).toEqual(employee);
    expect(component.submitSuccess).toContain('successfully');
    expect(component.requestForm.controls.type.value).toBeNull();
  });

  it('shows server validation errors and preserves the form for correction', () => {
    fillForm();
    component.submitRequest();
    http.expectOne(api).flush('Not enough vacation balance', { status: 400, statusText: 'Bad Request' });
    expect(component.submitError).toBe('Not enough vacation balance');
    expect(component.submitting).toBeFalse();
    expect(component.requestForm.controls.startDate.value).toBe('2026-03-01');
    expect(component.requests.length).toBe(0);
  });

  function pendingRequest(id: number) {
    return { id, employeeId: 1, employee, type: 0,
      startDate: '2026-03-01', endDate: '2026-03-03', days: 3, status: 0 };
  }

  it('disables the approval button for at least 800ms and updates only the approved row without reloading', fakeAsync(() => {
    const first = pendingRequest(10);
    const second = pendingRequest(11);
    component.requests = [first, second];
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('tbody button');
    button.click();
    component.approve(first.id);
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(button.textContent).toContain('Approving...');
    const request = http.expectOne(`${api}/10/approve`);
    expect(request.request.method).toBe('POST');
    request.flush({ ...first, employee: undefined, status: 1 });
    tick(799);
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(component.requests[0].status).toBe(0);
    tick(1);
    fixture.detectChanges();

    expect(component.approvingIds.size).toBe(0);
    expect(component.requests[0].status).toBe(1);
    expect(component.requests[0].employee).toEqual(employee);
    expect(component.requests[1]).toBe(second);
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows[0].querySelector('button').textContent).toContain('Approved');
    expect(rows[0].querySelector('button').disabled).toBeTrue();
    expect(rows[0].textContent).toContain('Request approved successfully.');
    http.expectNone(api);
  }));

  it('refreshes a stale status after a conflict and removes its approval button', fakeAsync(() => {
    component.requests = [pendingRequest(10)];
    component.approve(10);
    http.expectOne(`${api}/10/approve`).flush('Only pending leave requests can be approved',
      { status: 409, statusText: 'Conflict' });
    expect(component.approvingIds.has(10)).toBeTrue();
    http.expectOne(`${api}/10`).flush({ ...pendingRequest(10), status: 1 });
    tick(800);
    fixture.detectChanges();
    expect(component.requests[0].status).toBe(1);
    expect(component.approvingIds.size).toBe(0);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent)
      .toContain('already been approved or rejected');
    expect(component.approvalSuccesses[10]).toBeUndefined();
    expect(fixture.nativeElement.querySelector('tbody button').textContent).toContain('Approved');
    expect(fixture.nativeElement.querySelector('tbody button').disabled).toBeTrue();
    http.expectNone(api);
  }));

  it('displays persisted rejection for insufficient balance and prevents another approval', fakeAsync(() => {
    component.requests = [pendingRequest(10)];
    component.approve(10);
    http.expectOne(`${api}/10/approve`).flush({ message: 'Not enough vacation balance', request: { ...pendingRequest(10), status: 2 } },
      { status: 409, statusText: 'Conflict' });
    http.expectOne(`${api}/10`).flush({ ...pendingRequest(10), status: 2 });
    tick(799);
    expect(component.approvingIds.has(10)).toBeTrue();
    expect(component.approvalErrors[10]).toBeUndefined();
    tick(1);
    expect(component.approvalErrors[10]).toContain('Request rejected');
    expect(component.approvingIds.has(10)).toBeFalse();
    component.approve(10);
    http.expectNone(`${api}/10/approve`);
    fixture.detectChanges();
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('tbody button');
    expect(button.textContent).toContain('Rejected');
    expect(button.disabled).toBeTrue();
    expect(component.requests[0].status).toBe(2);
  }));

  it('keeps loading and feedback independent for simultaneous approvals', fakeAsync(() => {
    component.requests = [pendingRequest(10), pendingRequest(11)];
    component.approve(10);
    tick(400);
    component.approve(11);
    http.expectOne(`${api}/10/approve`).flush({ ...pendingRequest(10), status: 1 });
    tick(400);
    expect(component.approvingIds.has(10)).toBeFalse();
    expect(component.approvingIds.has(11)).toBeTrue();
    http.expectOne(`${api}/11/approve`).flush('Leave request not found',
      { status: 404, statusText: 'Not Found' });
    http.expectOne(`${api}/11`).flush('Leave request not found',
      { status: 404, statusText: 'Not Found' });
    tick(400);
    expect(component.approvalSuccesses[10]).toBeTruthy();
    expect(component.approvalErrors[11]).toBe('This request no longer exists.');
    expect(component.requests[0].status).toBe(1);
    expect(component.requests.length).toBe(1);
    expect(component.approvalNotice).toContain('removed');
    expect(component.approvingIds.size).toBe(0);
  }));

  it('ignores approvals for missing or already processed rows', () => {
    component.requests = [{ ...pendingRequest(10), status: 1 }];
    component.approve(10);
    component.approve(999);
    http.expectNone(request => request.method === 'POST');
    expect(component.approvingIds.size).toBe(0);
  });

  it('blocks overlapping dates including shared endpoints and enclosing ranges before POST', () => {
    component.requests = [pendingRequest(10)];
    for (const status of [0, 1]) {
      component.requests[0].status = status;
      for (const dates of [
        ['2026-03-01', '2026-03-03'], ['2026-03-03', '2026-03-05'],
        ['2026-02-28', '2026-03-01'], ['2026-02-28', '2026-03-05']
      ]) {
        fillForm();
        component.requestForm.patchValue({ startDate: dates[0], endDate: dates[1], type: 1 });
        component.submitRequest();
        expect(component.submitError).toContain('overlap');
        expect(component.submitting).toBeFalse();
        http.expectNone(request => request.method === 'POST');
      }
    }
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('These dates overlap');
  });

  it('allows adjacent ranges, rejected requests and requests for another employee', () => {
    fillForm();
    component.requests = [{ ...pendingRequest(10), startDate: '2026-02-27', endDate: '2026-02-28' }];
    expect(component.overlappingRequest).toBeUndefined();
    component.requests = [{ ...pendingRequest(10), status: 2 }];
    expect(component.overlappingRequest).toBeUndefined();
    component.requests = [{ ...pendingRequest(10), employeeId: 2 }];
    expect(component.overlappingRequest).toBeUndefined();
    component.submitRequest();
    http.expectOne(api).flush({ ...pendingRequest(11), employee: undefined });
    expect(component.submitSuccess).toBeTruthy();
  });

  it('keeps approval disabled if refreshing a stale status fails', fakeAsync(() => {
    component.requests = [pendingRequest(10)];
    component.approve(10);
    http.expectOne(`${api}/10/approve`).flush('Only pending leave requests can be approved',
      { status: 409, statusText: 'Conflict' });
    http.expectOne(`${api}/10`).flush('', { status: 500, statusText: 'Server Error' });
    tick(800);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('tbody button').disabled).toBeTrue();
    expect(component.approvalErrors[10]).toContain('Could not refresh');
    component.approve(10);
    http.expectNone(`${api}/10/approve`);
  }));

  it('preserves the response even if the completion notification has a shorter delay', fakeAsync(() => {
    component.requests = [pendingRequest(10)];
    const started = Date.now();
    spyOn(Date, 'now').and.returnValues(started, started, started + 800);
    component.approve(10);
    http.expectOne(`${api}/10/approve`).flush({ ...pendingRequest(10), status: 1 });
    tick(799);
    expect(component.requests[0].status).toBe(0);
    expect(component.approvingIds.has(10)).toBeTrue();
    tick(1);
    expect(component.requests[0].status).toBe(1);
    expect(component.approvingIds.has(10)).toBeFalse();
  }));

  it('clears old form errors as soon as input changes, without submitting again', () => {
    fillForm();
    component.submitRequest();
    http.expectOne(api).flush('Not enough vacation balance', { status: 400, statusText: 'Bad Request' });
    expect(component.submitError).toBeTruthy();
    component.requestForm.controls.endDate.setValue('2026-03-02');
    expect(component.submitError).toBe('');
    expect(component.submitSuccess).toBe('');
    http.expectNone(api);
  });

  it('clears the previous success when starting a new form', () => {
    fillForm();
    component.submitRequest();
    const request = http.expectOne(api);
    request.flush({ ...pendingRequest(10) });
    expect(component.submitSuccess).toBeTruthy();
    component.requestForm.controls.employeeId.setValue(1);
    expect(component.submitSuccess).toBe('');
  });

  it('keeps a request pending after a server error and allows a retry', fakeAsync(() => {
    component.requests = [pendingRequest(10)];
    component.approve(10);
    http.expectOne(`${api}/10/approve`).flush('', { status: 500, statusText: 'Server Error' });
    tick(800);
    expect(component.requests[0].status).toBe(0);
    expect(component.approvalErrors[10]).toContain('Please try again');
    component.approve(10);
    expect(component.approvalErrors[10]).toBeUndefined();
    http.expectOne(`${api}/10/approve`).flush({ ...pendingRequest(10), status: 1 });
    tick(800);
    expect(component.requests[0].status).toBe(1);
  }));
});
