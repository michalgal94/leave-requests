package com.example.leavemanagement.service;

import com.example.leavemanagement.dto.CreateLeaveRequestDto;
import com.example.leavemanagement.model.Employee;
import com.example.leavemanagement.model.LeaveRequest;
import com.example.leavemanagement.model.LeaveStatus;
import com.example.leavemanagement.model.LeaveType;
import com.example.leavemanagement.repository.EmployeeRepository;
import com.example.leavemanagement.repository.LeaveRequestRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.temporal.ChronoUnit;
import java.util.List;

import static com.example.leavemanagement.service.LeaveRequestException.Kind.*;

@Service
public class LeaveRequestService {
    private final EmployeeRepository employees;
    private final LeaveRequestRepository requests;

    public LeaveRequestService(EmployeeRepository employees, LeaveRequestRepository requests) {
        this.employees = employees;
        this.requests = requests;
    }

    @Transactional(readOnly = true)
    public List<LeaveRequest> getAll() {
        return requests.findAllByOrderByStartDateDesc();
    }

    @Transactional(readOnly = true)
    public LeaveRequest getById(Long id) {
        return requests.findById(id)
                .orElseThrow(() -> new LeaveRequestException(NOT_FOUND, "Leave request not found"));
    }

    @Transactional(readOnly = true)
    public List<LeaveRequest> search(String name) {
        if (name == null || name.isBlank() || name.length() > 100) {
            throw new LeaveRequestException(INVALID_REQUEST, "Search name must contain between 1 and 100 characters");
        }
        return requests.findByEmployeeName(name);
    }

    @Transactional
    public LeaveRequest create(CreateLeaveRequestDto dto) {
        if (dto.getStartDate().isAfter(dto.getEndDate())) {
            throw new LeaveRequestException(INVALID_REQUEST, "Start date must not be after end date");
        }
        // Serialize submissions for the same employee so concurrent overlaps cannot slip through.
        Employee employee = employees.findByIdForUpdate(dto.getEmployeeId())
                .orElseThrow(() -> new LeaveRequestException(NOT_FOUND, "Employee not found"));
        if (requests.hasOverlap(employee.getId(), dto.getStartDate(), dto.getEndDate(), LeaveStatus.REJECTED)) {
            throw new LeaveRequestException(INVALID_REQUEST,
                    "These dates overlap an existing pending or approved leave request for this employee.");
        }
        long days = ChronoUnit.DAYS.between(dto.getStartDate(), dto.getEndDate()) + 1;
        if (days > Integer.MAX_VALUE) {
            throw new LeaveRequestException(INVALID_REQUEST, "Leave duration is too large");
        }
        checkVacationBalance(employee, dto.getType(), (int) days, INVALID_REQUEST);

        LeaveRequest request = new LeaveRequest();
        request.setEmployeeId(employee.getId());
        request.setType(dto.getType());
        request.setStartDate(dto.getStartDate());
        request.setEndDate(dto.getEndDate());
        request.setDays((int) days);
        request.setStatus(LeaveStatus.PENDING);
        return requests.save(request);
    }

    @Transactional
    public LeaveApprovalResult approve(Long id) {
        // Always lock the request before its employee; keep both locks until commit.
        LeaveRequest request = requests.findByIdForUpdate(id)
                .orElseThrow(() -> new LeaveRequestException(NOT_FOUND, "Leave request not found"));
        if (request.getStatus() != LeaveStatus.PENDING) {
            throw new LeaveRequestException(CONFLICT, "Only pending leave requests can be approved");
        }
        Employee employee = employees.findByIdForUpdate(request.getEmployeeId())
                .orElseThrow(() -> new LeaveRequestException(NOT_FOUND, "Employee not found"));
        if (!hasVacationBalance(employee, request.getType(), request.getDays())) {
            request.setStatus(LeaveStatus.REJECTED);
            return new LeaveApprovalResult(requests.save(request), "Not enough vacation balance");
        }
        request.setStatus(LeaveStatus.APPROVED);
        return new LeaveApprovalResult(requests.save(request), null);
    }

    private void checkVacationBalance(Employee employee, LeaveType type, int days,
                                      LeaveRequestException.Kind failureKind) {
        if (!hasVacationBalance(employee, type, days)) {
            throw new LeaveRequestException(failureKind, "Not enough vacation balance");
        }
    }

    private boolean hasVacationBalance(Employee employee, LeaveType type, int days) {
        if (type != LeaveType.VACATION) return true;
        long used = requests.findByEmployeeIdAndTypeAndStatus(employee.getId(),
                        LeaveType.VACATION, LeaveStatus.APPROVED)
                .stream().mapToLong(LeaveRequest::getDays).sum();
        return used + days <= employee.getAnnualQuota();
    }
}
