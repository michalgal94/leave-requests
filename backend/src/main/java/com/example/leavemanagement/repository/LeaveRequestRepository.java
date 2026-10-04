package com.example.leavemanagement.repository;

import com.example.leavemanagement.model.LeaveRequest;
import com.example.leavemanagement.model.LeaveStatus;
import com.example.leavemanagement.model.LeaveType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;
import java.time.LocalDate;

public interface LeaveRequestRepository extends JpaRepository<LeaveRequest, Long> {
    @Query("select count(r) > 0 from LeaveRequest r where r.employeeId = :employeeId " +
            "and r.status <> :rejected and r.startDate <= :endDate and r.endDate >= :startDate")
    boolean hasOverlap(@Param("employeeId") Long employeeId, @Param("startDate") LocalDate startDate,
                       @Param("endDate") LocalDate endDate, @Param("rejected") LeaveStatus rejected);

    List<LeaveRequest> findAllByOrderByStartDateDesc();

    @Query("select r from LeaveRequest r join r.employee e where e.name like concat('%', :name, '%')")
    List<LeaveRequest> findByEmployeeName(@Param("name") String name);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from LeaveRequest r where r.id = :id")
    Optional<LeaveRequest> findByIdForUpdate(@Param("id") Long id);

    List<LeaveRequest> findByEmployeeIdAndTypeAndStatus(Long employeeId, LeaveType type, LeaveStatus status);
}
