package com.example.leavemanagement.controller;

import com.example.leavemanagement.dto.CreateLeaveRequestDto;
import com.example.leavemanagement.model.LeaveRequest;
import com.example.leavemanagement.service.LeaveRequestService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/leave-requests")
public class LeaveRequestsController {
    private final LeaveRequestService service;

    public LeaveRequestsController(LeaveRequestService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<LeaveRequest>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @GetMapping("/search")
    public ResponseEntity<List<LeaveRequest>> search(@RequestParam String name) {
        return ResponseEntity.ok(service.search(name));
    }

    @GetMapping("/{id}")
    public ResponseEntity<LeaveRequest> getById(@PathVariable Long id) {
        return ResponseEntity.ok(service.getById(id));
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<?> approve(@PathVariable Long id) {
        var result = service.approve(id);
        if (result.rejectionReason() != null) {
            return ResponseEntity.status(409).body(Map.of(
                    "message", result.rejectionReason(), "request", result.request()));
        }
        return ResponseEntity.ok(result.request());
    }

    @PostMapping
    public ResponseEntity<LeaveRequest> create(@Valid @RequestBody CreateLeaveRequestDto dto) {
        return ResponseEntity.ok(service.create(dto));
    }
}
