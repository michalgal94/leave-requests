package com.example.leavemanagement;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.example.leavemanagement.dto.CreateLeaveRequestDto;
import com.example.leavemanagement.model.Employee;
import com.example.leavemanagement.model.LeaveRequest;
import com.example.leavemanagement.model.LeaveStatus;
import com.example.leavemanagement.model.LeaveType;
import com.example.leavemanagement.repository.EmployeeRepository;
import com.example.leavemanagement.repository.LeaveRequestRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

// Runs against a real, throwaway PostgreSQL started by Testcontainers.
// (Docker must be available on the machine running the tests.)
@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
class LeaveRequestsTests {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private EmployeeRepository employees;

    @Autowired
    private LeaveRequestRepository leaveRequests;

    @Autowired
    private MockMvc mockMvc;

    @Test
    void create_WithinQuota_Succeeds() throws Exception {
        // Arrange
        Employee emp = new Employee();
        emp.setName("Test Emp");
        emp.setAnnualQuota(20);
        employees.save(emp);

        long before = leaveRequests.count();

        CreateLeaveRequestDto dto = new CreateLeaveRequestDto();
        dto.setEmployeeId(emp.getId());
        dto.setType(LeaveType.VACATION);
        dto.setStartDate(LocalDate.of(2026, 3, 1));
        dto.setEndDate(LocalDate.of(2026, 3, 3)); // 3 days, well within the quota

        // Act
        mockMvc.perform(post("/api/leave-requests")
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(dto)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.days").value(3))
                .andExpect(jsonPath("$.status").value(LeaveStatus.PENDING.ordinal()));

        // Assert
        assertEquals(before + 1, leaveRequests.count());
    }

    @Test
    void create_ExceedsRemainingVacationBalance_IsRejected() throws Exception {
        // Arrange: only 2 of the employee's 20 vacation days remain.
        Employee emp = new Employee();
        emp.setName("Employee with used vacation days");
        emp.setAnnualQuota(20);
        employees.save(emp);

        LeaveRequest approved = new LeaveRequest();
        approved.setEmployeeId(emp.getId());
        approved.setType(LeaveType.VACATION);
        approved.setStatus(LeaveStatus.APPROVED);
        approved.setStartDate(LocalDate.of(2026, 1, 1));
        approved.setEndDate(LocalDate.of(2026, 1, 18));
        approved.setDays(18);
        leaveRequests.save(approved);

        long before = leaveRequests.count();

        CreateLeaveRequestDto dto = new CreateLeaveRequestDto();
        dto.setEmployeeId(emp.getId());
        dto.setType(LeaveType.VACATION);
        dto.setStartDate(LocalDate.of(2026, 3, 1));
        dto.setEndDate(LocalDate.of(2026, 3, 3)); // 3 days: 18 + 3 exceeds 20.

        // Act
        mockMvc.perform(post("/api/leave-requests")
                        .contentType(MediaType.APPLICATION_JSON).content(objectMapper.writeValueAsString(dto)))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("Not enough vacation balance"));

        // Assert: reject the request without saving it.
        assertEquals(before, leaveRequests.count());
    }

    @Test
    void approve_PendingRequestAtQuota_Succeeds() throws Exception {
        Employee employee = employeeWithQuota(20);
        savedRequest(employee, 18, LeaveStatus.APPROVED, LeaveType.VACATION);
        LeaveRequest pending = savedRequest(employee, 2, LeaveStatus.PENDING, LeaveType.VACATION);

        mockMvc.perform(post("/api/leave-requests/{id}/approve", pending.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(pending.getId()))
                .andExpect(jsonPath("$.status").value(LeaveStatus.APPROVED.ordinal()));

        assertEquals(LeaveStatus.APPROVED, leaveRequests.findById(pending.getId()).orElseThrow().getStatus());
    }

    @Test
    void approve_MissingRequest_ReturnsNotFound() throws Exception {
        mockMvc.perform(post("/api/leave-requests/{id}/approve", Long.MAX_VALUE))
                .andExpect(status().isNotFound());
    }

    @Test
    void approve_AlreadyApprovedOrRejected_ReturnsConflict() throws Exception {
        Employee employee = employeeWithQuota(20);
        for (LeaveStatus status : List.of(LeaveStatus.APPROVED, LeaveStatus.REJECTED)) {
            LeaveRequest request = savedRequest(employee, 1, status, LeaveType.VACATION);
            mockMvc.perform(post("/api/leave-requests/{id}/approve", request.getId()))
                    .andExpect(status().isConflict());
            assertEquals(status, leaveRequests.findById(request.getId()).orElseThrow().getStatus());
        }
    }

    @Test
    void approve_ExceedsRemainingBalance_ReturnsConflictAndPersistsRejection() throws Exception {
        Employee employee = employeeWithQuota(20);
        savedRequest(employee, 18, LeaveStatus.APPROVED, LeaveType.VACATION);
        LeaveRequest pending = savedRequest(employee, 3, LeaveStatus.PENDING, LeaveType.VACATION);

        mockMvc.perform(post("/api/leave-requests/{id}/approve", pending.getId()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Not enough vacation balance"))
                .andExpect(jsonPath("$.request.status").value(LeaveStatus.REJECTED.ordinal()));

        assertEquals(LeaveStatus.REJECTED, leaveRequests.findById(pending.getId()).orElseThrow().getStatus());
        mockMvc.perform(post("/api/leave-requests/{id}/approve", pending.getId()))
                .andExpect(status().isConflict());
    }

    @Test
    void approve_NonVacationRequest_DoesNotConsumeVacationQuota() throws Exception {
        Employee employee = employeeWithQuota(0);
        LeaveRequest pending = savedRequest(employee, 3, LeaveStatus.PENDING, LeaveType.SICK);

        mockMvc.perform(post("/api/leave-requests/{id}/approve", pending.getId()))
                .andExpect(status().isOk());
        assertEquals(LeaveStatus.APPROVED, leaveRequests.findById(pending.getId()).orElseThrow().getStatus());
    }

    @Test
    void approve_ConcurrentRequestsForSameEmployee_CannotExceedQuota() throws Exception {
        Employee employee = employeeWithQuota(20);
        savedRequest(employee, 18, LeaveStatus.APPROVED, LeaveType.VACATION);
        LeaveRequest first = savedRequest(employee, 2, LeaveStatus.PENDING, LeaveType.VACATION);
        LeaveRequest second = savedRequest(employee, 2, LeaveStatus.PENDING, LeaveType.VACATION);

        List<Integer> results = approveConcurrently(first.getId(), second.getId());

        assertEquals(1, results.stream().filter(code -> code == 200).count());
        assertEquals(1, results.stream().filter(code -> code == 409).count());
        List<LeaveRequest> approved = leaveRequests.findByEmployeeIdAndTypeAndStatus(
                employee.getId(), LeaveType.VACATION, LeaveStatus.APPROVED);
        assertEquals(20, approved.stream().mapToInt(LeaveRequest::getDays).sum());
        assertEquals(1, List.of(first, second).stream()
                .filter(request -> leaveRequests.findById(request.getId()).orElseThrow().getStatus()
                        == LeaveStatus.REJECTED).count());
    }

    @Test
    void approve_SameRequestConcurrently_OnlyOneApprovalSucceeds() throws Exception {
        Employee employee = employeeWithQuota(20);
        LeaveRequest pending = savedRequest(employee, 2, LeaveStatus.PENDING, LeaveType.VACATION);

        List<Integer> results = approveConcurrently(pending.getId(), pending.getId());

        assertEquals(1, results.stream().filter(code -> code == 200).count());
        assertEquals(1, results.stream().filter(code -> code == 409).count());
        assertEquals(LeaveStatus.APPROVED, leaveRequests.findById(pending.getId()).orElseThrow().getStatus());
    }

    private List<Integer> approveConcurrently(Long firstId, Long secondId) throws Exception {
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> {
                ready.countDown();
                assertTrue(start.await(10, TimeUnit.SECONDS));
                return mockMvc.perform(post("/api/leave-requests/{id}/approve", firstId))
                        .andReturn().getResponse().getStatus();
            });
            var second = executor.submit(() -> {
                ready.countDown();
                assertTrue(start.await(10, TimeUnit.SECONDS));
                return mockMvc.perform(post("/api/leave-requests/{id}/approve", secondId))
                        .andReturn().getResponse().getStatus();
            });
            try {
                assertTrue(ready.await(10, TimeUnit.SECONDS));
            } finally {
                start.countDown();
            }
            return List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
        }
    }

    @Test
    void create_MissingRequiredFieldsOrInvalidEmployeeId_ReturnsBadRequest() throws Exception {
        Employee employee = employeeWithQuota(20);
        String valid = "{\"employeeId\":" + employee.getId()
                + ",\"type\":0,\"startDate\":\"2026-03-01\",\"endDate\":\"2026-03-03\"}";
        long before = leaveRequests.count();
        for (String field : List.of("employeeId", "type", "startDate", "endDate")) {
            ObjectNode payload = (ObjectNode) objectMapper.readTree(valid);
            payload.remove(field);
            mockMvc.perform(post("/api/leave-requests")
                            .contentType(MediaType.APPLICATION_JSON).content(payload.toString()))
                    .andExpect(status().isBadRequest());
        }
        ObjectNode payload = (ObjectNode) objectMapper.readTree(valid);
        payload.put("employeeId", -1);
        mockMvc.perform(post("/api/leave-requests")
                        .contentType(MediaType.APPLICATION_JSON).content(payload.toString()))
                .andExpect(status().isBadRequest());
        assertEquals(before, leaveRequests.count());
    }

    @Test
    void create_ReversedDates_ReturnsBadRequestWithoutSaving() throws Exception {
        Employee employee = employeeWithQuota(20);
        long before = leaveRequests.count();
        mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"employeeId\":" + employee.getId()
                                + ",\"type\":0,\"startDate\":\"2026-03-03\",\"endDate\":\"2026-03-01\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string("Start date must not be after end date"));
        assertEquals(before, leaveRequests.count());
    }

    @Test
    void create_MissingEmployee_ReturnsNotFound() throws Exception {
        mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"employeeId\":" + Long.MAX_VALUE
                                + ",\"type\":0,\"startDate\":\"2026-03-01\",\"endDate\":\"2026-03-01\"}"))
                .andExpect(status().isNotFound())
                .andExpect(content().string("Employee not found"));
    }

    @Test
    void search_QuotedNameIsData_NotSql() throws Exception {
        Employee employee = employeeWithQuota(20);
        employee.setName("O'Connor regression employee");
        employees.save(employee);
        LeaveRequest request = savedRequest(employee, 1, LeaveStatus.PENDING, LeaveType.VACATION);

        mockMvc.perform(get("/api/leave-requests/search").param("name", "O'Connor regression"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(request.getId()));
        mockMvc.perform(get("/api/leave-requests/search").param("name", "' OR 1=1 --"))
                .andExpect(status().isOk())
                .andExpect(content().json("[]"));
    }

    @Test
    void getAll_OrdersRequestsByStartDateDescending() throws Exception {
        Employee employee = employeeWithQuota(20);
        LeaveRequest request = savedRequest(employee, 1, LeaveStatus.PENDING, LeaveType.VACATION);
        request.setStartDate(LocalDate.of(2099, 1, 1));
        request.setEndDate(request.getStartDate());
        leaveRequests.save(request);

        mockMvc.perform(get("/api/leave-requests"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(request.getId()));
    }

    @Test
    void getById_ReturnsCurrentStatusOrNotFound() throws Exception {
        Employee employee = employeeWithQuota(20);
        LeaveRequest approved = savedRequest(employee, 1, LeaveStatus.APPROVED, LeaveType.VACATION);
        mockMvc.perform(get("/api/leave-requests/{id}", approved.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(LeaveStatus.APPROVED.ordinal()));
        mockMvc.perform(get("/api/leave-requests/{id}", Long.MAX_VALUE))
                .andExpect(status().isNotFound());
    }

    @Test
    void create_OverlapsPendingOrApprovedRequest_IsRejectedWithoutSaving() throws Exception {
        for (LeaveStatus existingStatus : List.of(LeaveStatus.PENDING, LeaveStatus.APPROVED)) {
            Employee employee = employeeWithQuota(100);
            savedRequest(employee, 3, existingStatus, LeaveType.VACATION);
            long before = leaveRequests.count();
            for (String[] dates : List.of(
                    new String[]{"2026-01-01", "2026-01-03"},
                    new String[]{"2026-01-03", "2026-01-05"},
                    new String[]{"2025-12-30", "2026-01-01"},
                    new String[]{"2025-12-30", "2026-01-05"},
                    new String[]{"2026-01-02", "2026-01-02"})) {
                mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                                .content(createPayload(employee.getId(), dates[0], dates[1])))
                        .andExpect(status().isBadRequest())
                        .andExpect(content().string("These dates overlap an existing pending or approved leave request for this employee."));
            }
            assertEquals(before, leaveRequests.count());
        }
    }

    @Test
    void create_AdjacentDatesRejectedRequestsAndOtherEmployees_DoNotBlockSubmission() throws Exception {
        Employee employee = employeeWithQuota(100);
        savedRequest(employee, 3, LeaveStatus.REJECTED, LeaveType.VACATION);
        savedRequest(employeeWithQuota(100), 3, LeaveStatus.APPROVED, LeaveType.VACATION);
        mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                        .content(createPayload(employee.getId(), "2026-01-01", "2026-01-03")))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                        .content(createPayload(employee.getId(), "2026-01-04", "2026-01-04")))
                .andExpect(status().isOk());
    }

    @Test
    void create_ConcurrentOverlappingRequests_OnlyOneIsSaved() throws Exception {
        Employee employee = employeeWithQuota(100);
        String payload = createPayload(employee.getId(), "2026-04-01", "2026-04-03");
        long before = leaveRequests.count();
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<Integer> submit = () -> {
                ready.countDown();
                assertTrue(start.await(10, TimeUnit.SECONDS));
                return mockMvc.perform(post("/api/leave-requests").contentType(MediaType.APPLICATION_JSON)
                                .content(payload)).andReturn().getResponse().getStatus();
            };
            var first = executor.submit(submit);
            var second = executor.submit(submit);
            try {
                assertTrue(ready.await(10, TimeUnit.SECONDS));
            } finally {
                start.countDown();
            }
            List<Integer> results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(code -> code == 200).count());
            assertEquals(1, results.stream().filter(code -> code == 400).count());
        }
        assertEquals(before + 1, leaveRequests.count());
    }

    private String createPayload(Long employeeId, String startDate, String endDate) {
        return "{\"employeeId\":" + employeeId + ",\"type\":1,\"startDate\":\""
                + startDate + "\",\"endDate\":\"" + endDate + "\"}";
    }

    private Employee employeeWithQuota(int quota) {
        Employee employee = new Employee();
        employee.setName("Approval test employee");
        employee.setAnnualQuota(quota);
        return employees.save(employee);
    }

    private LeaveRequest savedRequest(Employee employee, int days, LeaveStatus status, LeaveType type) {
        LeaveRequest request = new LeaveRequest();
        request.setEmployeeId(employee.getId());
        request.setType(type);
        request.setStatus(status);
        request.setStartDate(LocalDate.of(2026, 1, 1));
        request.setEndDate(request.getStartDate().plusDays(days - 1));
        request.setDays(days);
        return leaveRequests.save(request);
    }
}
