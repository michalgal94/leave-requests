package com.example.leavemanagement.service;

import com.example.leavemanagement.model.LeaveRequest;

public record LeaveApprovalResult(LeaveRequest request, String rejectionReason) {
}
